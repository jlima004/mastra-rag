import assert from 'node:assert/strict';
import test from 'node:test';
import { RAG_LIMITS } from '../contracts/types.ts';
import { RagEmbeddingError } from './errors.ts';
import { requireEmbeddingUsage, validateEmbeddingVectors, type EmbeddingProvider } from './provider.ts';
import { assertProviderMatchesSpace, EMBEDDING_SPACES, requireEmbeddingSpace } from './space.ts';
import {
  createOpenAIEmbeddingProvider, OPENAI_ROUTER_MODEL_ID, parseRetryAfter,
  sanitizeProviderFailure, type RouterEmbeddingModel,
} from './openai.ts';
import {
  conservativeInputTokenUpperBound, embedMissingDocumentChunks, planEmbeddingJob,
  type DocumentEmbeddingInput, type EmbeddingJobArguments,
} from './job.ts';

const signal = new AbortController().signal;
const SPACE_ID = 'chunks_te3s_1536_v1';
const VALID_VECTOR = Object.freeze(Array.from({ length: 1536 }, (_, i) => i / 1536));
const fixtureChunks = (count: number): DocumentEmbeddingInput[] =>
  Array.from({ length: count }, (_, i) => ({
    chunkId: i.toString(16).padStart(64, '0'),
    text: 'Texto sintético ' + i,
  }));
function code(error: unknown, value: string): boolean {
  assert.ok(error instanceof RagEmbeddingError);
  assert.equal(error.code, value);
  assert.equal(error.message, value);
  assert.equal('cause' in error, false);
  return true;
}
function fakeProvider(
  embed: EmbeddingProvider['embed'] = async inputs => ({
    vectors: inputs.map(() => [...VALID_VECTOR]), usage: { tokens: inputs.length * 2 },
  }),
): EmbeddingProvider {
  return Object.freeze({
    spaceId: SPACE_ID, dimension: 1536, maxInputsPerCall: 128,
    maxInputTokens: 8191, embed,
  });
}
function args(
  chunks: readonly DocumentEmbeddingInput[],
  provider: EmbeddingProvider = fakeProvider(),
  more: Partial<EmbeddingJobArguments> = {},
): EmbeddingJobArguments {
  return {
    provider, chunks, signal, tokenBudget: RAG_LIMITS.MAX_TOKENS_PER_JOB,
    remainingDailyTokens: RAG_LIMITS.MAX_TOKENS_PER_JOB, ...more,
  };
}

test('typed space registry is immutable and rejects cross-space vector writes', () => {
  const space = requireEmbeddingSpace(SPACE_ID);
  assert.equal(space.embeddingModel, 'text-embedding-3-small');
  assert.equal(space.dimension, 1536);
  assert.equal(space.status, 'building');
  assert.ok(Object.isFrozen(space) && Object.isFrozen(EMBEDDING_SPACES));
  assertProviderMatchesSpace(fakeProvider(), space);
  assert.throws(() => requireEmbeddingSpace('chunks_unapproved_1536_v2'), e => code(e,'EMBED_INVALID_SPACE'));
  assert.throws(() => assertProviderMatchesSpace({ spaceId:SPACE_ID, dimension: 768 }, space),
    e => code(e,'EMBED_INVALID_SPACE'));
});

test('OpenAI model router adapter is lazy and gated with no environment key', async () => {
  assert.equal(OPENAI_ROUTER_MODEL_ID, 'openai/text-embedding-3-small');
  const before = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const provider = createOpenAIEmbeddingProvider();
    assert.equal(provider.dimension, 1536);
    assert.equal(provider.maxInputTokens, 8191);
    await assert.rejects(provider.embed(['hello'],{signal,purpose:'document'}),
      e => code(e,'EMBED_PAID_NOT_AUTHORIZED'));
    // A missing API key must never break module import or Mastra startup.
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
});

test('injected Mastra doEmbed boundary forwards inputs/signal but creates model only on call', async () => {
  let initialized = 0;
  const inputsObserved: string[][] = [];
  const mock: RouterEmbeddingModel = {
    async doEmbed({ values, abortSignal }) {
      inputsObserved.push(values);
      assert.equal(abortSignal, signal);
      return { embeddings: values.map(() => [...VALID_VECTOR]), usage: { tokens: 5 } };
    },
  };
  const provider = createOpenAIEmbeddingProvider({
    modelFactory: async () => { initialized++; return mock; },
  });
  assert.equal(initialized, 0);
  const a = await provider.embed(['palavra sintética'],{signal,purpose:'document'});
  const b = await provider.embed(['query sintética'],{signal,purpose:'query'});
  assert.equal(initialized, 1);
  assert.equal(a.vectors[0].length, 1536);
  assert.equal(b.usage.tokens, 5);
  assert.deepEqual(inputsObserved,[['palavra sintética'],['query sintética']]);
});

test('lazy router constructor failures are sanitized even before doEmbed', async () => {
  const secret='RAW_PROVIDER_CONSTRUCTOR_SECRET';
  const provider=createOpenAIEmbeddingProvider({
    modelFactory: async()=>{throw new Error(secret);},
  });
  await assert.rejects(provider.embed(['synthetic'],{signal,purpose:'document'}), e => {
    assert.ok(code(e,'EMBED_PROVIDER_FAILURE'));
    assert.doesNotMatch(JSON.stringify(e),/RAW_PROVIDER_CONSTRUCTOR_SECRET/);
    return true;
  });
});

test('provider validates shape and finite values before returning embeddings', async () => {
  const wrongShape = createOpenAIEmbeddingProvider({
    modelFactory: () => ({ doEmbed: async () => ({
      embeddings: [[1,2]], usage: { tokens: 1 },
    }) }),
  });
  await assert.rejects(wrongShape.embed(['a'],{signal,purpose:'document'}),
    e => code(e,'EMBED_DIMENSION_MISMATCH'));
  const wrongValue = createOpenAIEmbeddingProvider({
    modelFactory: () => ({ doEmbed: async () => ({
      embeddings: [[...VALID_VECTOR.slice(0,1535), NaN]], usage: { tokens: 1 },
    }) }),
  });
  await assert.rejects(wrongValue.embed(['a'],{signal,purpose:'document'}),
    e => code(e,'EMBED_NONFINITE_VECTOR'));
  assert.throws(() => validateEmbeddingVectors([new Array(1536).fill(Infinity)],1,1536),
    e => code(e,'EMBED_NONFINITE_VECTOR'));
  assert.throws(() => requireEmbeddingUsage({ tokens: -1 }),e => code(e,'EMBED_USAGE_INVALID'));
  assert.throws(() => requireEmbeddingUsage({ tokens: '10' }),e => code(e,'EMBED_USAGE_INVALID'));
});

test('upstream provider errors are reduced to fixed codes without leaked text or API keys', async () => {
  const secret = 'KEY_SECRET_NOT_TO_EXPOSE_123';
  const adapter = createOpenAIEmbeddingProvider({
    modelFactory: () => ({ doEmbed: async () => { throw Object.assign(
      new Error('raw content ' + secret), { status: 429, headers: {'retry-after':'2'} },
    ); } }),
  });
  await assert.rejects(adapter.embed(['sensitive text'],{signal,purpose:'document'}), e => {
    assert.ok(code(e,'EMBED_PROVIDER_TRANSIENT'));
    assert.equal(e.retryable,true);
    assert.equal(e.retryAfterMs,2000);
    assert.doesNotMatch(JSON.stringify(e),/KEY_SECRET_NOT_TO_EXPOSE_123/);
    return true;
  });
  const bad = sanitizeProviderFailure(
    Object.assign(new Error(secret), { status: 401 }), signal);
  assert.ok(code(bad,'EMBED_PROVIDER_FAILURE'));
  assert.equal(bad.retryable,false);
});

test('Retry-After parser handles seconds and HTTP dates and refuses malicious/oversized values', () => {
  assert.equal(parseRetryAfter('3'),3000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT',
    Date.parse('Wed, 21 Oct 2015 07:27:58 GMT')),2000);
  assert.equal(parseRetryAfter('this is not a date'),null);
  assert.equal(parseRetryAfter('-1'),null);
  assert.equal(parseRetryAfter('999999999999999999'),null);
});

test('preflight batches at 128, reports call cap and stays pure', () => {
  const input = fixtureChunks(257);
  const plan = planEmbeddingJob(args(input));
  assert.equal(plan.batchCount,3);
  assert.equal(plan.batchSize,128);
  assert.equal(plan.maxProviderCalls,6);
  assert.equal(plan.missingCount,257);
  assert.equal(plan.skippedCount,0);
  assert.ok(plan.worstCaseTokenReservation > plan.estimatedTokenUpperBound);
  assert.ok(plan.worstCaseTokenReservation <= RAG_LIMITS.MAX_TOKENS_PER_JOB);
});

test('batch executor validates vectors, preserves order, and resumes only missing IDs', async () => {
  let calls=0;
  const provider=fakeProvider(async inputs => {
    calls++;
    return { vectors:inputs.map(() => [...VALID_VECTOR]),usage:{tokens:inputs.length*2} };
  });
  const items=fixtureChunks(130);
  const existing=items.slice(0,5).map(c=>c.chunkId);
  const result=await embedMissingDocumentChunks(args(items,provider,{existingChunkIds:existing}));
  assert.equal(result.plan.skippedCount,5);
  assert.equal(result.plan.batchCount,1);
  assert.equal(result.providerCalls,1);
  assert.equal(result.retriesUsed,0);
  assert.equal(calls,1);
  assert.deepEqual(result.embedded.map(c=>c.chunkId),items.slice(5).map(c=>c.chunkId));
  assert.ok(result.embedded.every(c=>c.vector.length===1536));
  assert.equal(result.reportedUsageTokens,250);
});

test('resume all-existing makes zero provider calls and reserves zero tokens', async () => {
  const input=fixtureChunks(5);
  const provider=fakeProvider(async () => { throw new Error('SHOULD_NOT_CALL'); });
  const result=await embedMissingDocumentChunks(args(input,provider,
    {existingChunkIds:input.map(x=>x.chunkId)}));
  assert.equal(result.providerCalls,0);
  assert.equal(result.plan.maxProviderCalls,0);
  assert.equal(result.reservedTokenUpperBound,0);
  assert.deepEqual(result.embedded,[]);
});

test('global retry budget is shared across all batches and cannot retry each batch four times', async () => {
  const input=fixtureChunks(258);
  let calls=0;
  const provider=fakeProvider(async inputs => {
    calls++;
    if (calls===1 || calls===3 || calls===5) {
      throw new RagEmbeddingError('EMBED_PROVIDER_TRANSIENT',{retryable:true,retryAfterMs:2000});
    }
    return {vectors:inputs.map(()=>[...VALID_VECTOR]), usage:{tokens:inputs.length*2}};
  });
  const sleeps:number[]=[];
  const result=await embedMissingDocumentChunks(args(input,provider),{
    random:()=>0,
    sleep: async delay=>{sleeps.push(delay);},
  });
  assert.equal(result.plan.batchCount,3);
  assert.equal(result.plan.maxProviderCalls,6);
  assert.equal(calls,6);
  assert.equal(result.providerCalls,6);
  assert.equal(result.retriesUsed,3);
  assert.deepEqual(sleeps,[2000,2000,2000]);
  assert.equal(result.embedded.length,258);
  assert.ok(result.reservedTokenUpperBound<=result.plan.worstCaseTokenReservation);
});

test('transient errors stop after at most four globally-budgeted attempts', async () => {
  let count=0;
  const provider=fakeProvider(async()=>{count++;throw new RagEmbeddingError(
    'EMBED_PROVIDER_TRANSIENT',{retryable:true},
  );});
  await assert.rejects(embedMissingDocumentChunks(args(fixtureChunks(2),provider),{
    random:()=>0,
    sleep:async()=>{},
  }), e=>code(e,'EMBED_RETRY_EXHAUSTED'));
  assert.equal(count,4);
});

test('no paid call starts when worst-case reservation exceeds job or daily cap', async () => {
  let count=0;
  const provider=fakeProvider(async()=>{count++;throw new Error('NEVER');});
  const input=fixtureChunks(128);
  const safePlan=planEmbeddingJob(args(input,provider));
  await assert.rejects(embedMissingDocumentChunks(args(input,provider,{
    tokenBudget:safePlan.estimatedTokenUpperBound,
  })),e=>code(e,'EMBED_BUDGET_EXCEEDED'));
  await assert.rejects(embedMissingDocumentChunks(args(input,provider,{
    remainingDailyTokens:safePlan.estimatedTokenUpperBound,
  })),e=>code(e,'EMBED_BUDGET_EXCEEDED'));
  assert.equal(count,0);
});

test('invalid chunk inputs, duplicate IDs and incorrect provider space fail before calling', () => {
  const p=fakeProvider();
  const invalid=[
    [{chunkId:'wrong',text:'ok'}],
    [{chunkId:'a'.repeat(64),text:'ok'}, {chunkId:'a'.repeat(64),text:'again'}],
    [{chunkId:'a'.repeat(64),text:' '}],
    [{chunkId:'a'.repeat(64),text:'X'.repeat(1020)}],
    [{chunkId:'a'.repeat(64),text:'\uD800'}],
  ];
  for(const chunks of invalid)assert.throws(()=>planEmbeddingJob(args(chunks,p)),e=>code(e,'EMBED_INVALID_INPUT'));
  assert.throws(()=>planEmbeddingJob(args(fixtureChunks(2),p,{existingChunkIds:['f'.repeat(64)]})),
    e=>code(e,'EMBED_INVALID_INPUT'));
  const wrong=fakeProvider(async inputs=>({vectors:inputs.map(()=>[...VALID_VECTOR]), usage:{tokens:1}}));
  assert.throws(()=>planEmbeddingJob(args(fixtureChunks(2),{...wrong,dimension:768})),
    e=>code(e,'EMBED_INVALID_SPACE'));
});

test('abort cancels before first call and during retry sleep without a fifth attempt', async () => {
  const aborted=new AbortController();
  aborted.abort();
  let called=0;
  const provider=fakeProvider(async()=>{called++;throw new Error('NO');});
  await assert.rejects(embedMissingDocumentChunks(args(fixtureChunks(1),provider,{
    signal:aborted.signal,
  })),e=>code(e,'EMBED_ABORTED'));
  assert.equal(called,0);
  const controller=new AbortController();
  const retryProvider=fakeProvider(async()=>{called++;throw new RagEmbeddingError(
    'EMBED_PROVIDER_TRANSIENT',{retryable:true},
  );});
  await assert.rejects(embedMissingDocumentChunks(args(fixtureChunks(1),retryProvider,{
    signal:controller.signal,
  }),{
    random:()=>0,
    sleep:async()=>{controller.abort();throw new Error('secret signal');},
  }),e=>code(e,'EMBED_ABORTED'));
  assert.equal(called,1);
});

test('oversized Retry-After refuses retry rather than violating provider rate limit', async () => {
  let called=0;
  const provider=fakeProvider(async()=>{called++;throw new RagEmbeddingError(
    'EMBED_PROVIDER_TRANSIENT',{retryable:true,retryAfterMs:60_000},
  );});
  await assert.rejects(embedMissingDocumentChunks(args(fixtureChunks(1),provider),{
    random:()=>0,
    sleep:async()=>{},
  }),e=>code(e,'EMBED_RETRY_DELAY_EXCEEDED'));
  assert.equal(called,1);
});

test('provider dimension mismatch or invalid usage halts job before any persistence', async () => {
  const wrong=fakeProvider(async()=>({vectors:[[1,2]],usage:{tokens:1}}));
  await assert.rejects(embedMissingDocumentChunks(args(fixtureChunks(1),wrong)),
    e=>code(e,'EMBED_DIMENSION_MISMATCH'));
  const badUsage=fakeProvider(async()=>({vectors:[[...VALID_VECTOR]],usage:{tokens:9_999_999}}));
  await assert.rejects(embedMissingDocumentChunks(args(fixtureChunks(1),badUsage)),
    e=>code(e,'EMBED_USAGE_INVALID'));
});

test('max input count and fake provider async error keep messages sanitized', async () => {
  const injected=createOpenAIEmbeddingProvider({
    modelFactory:()=>({doEmbed:async()=>{throw new Error('SECRET-EMBEDDING-INPUT');}}),
  });
  await assert.rejects(injected.embed(['a'],{signal,purpose:'query'}),
    e=>code(e,'EMBED_PROVIDER_FAILURE'));
  await assert.rejects(injected.embed(new Array(129).fill('test'),{signal,purpose:'document'}),
    e=>code(e,'EMBED_INVALID_INPUT'));
  const tokens=conservativeInputTokenUpperBound('Árvore');
  assert.ok(tokens > Buffer.byteLength('Árvore'));
});
