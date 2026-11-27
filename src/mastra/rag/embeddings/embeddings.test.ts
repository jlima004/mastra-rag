import assert from 'node:assert/strict';
import test from 'node:test';
import { RAG_LIMITS } from '../contracts/types.ts';
import { RagEmbeddingError } from './errors.ts';
import { requireEmbeddingUsage, validateEmbeddingVectors, type EmbeddingProvider } from './provider.ts';
import { assertProviderMatchesSpace, EMBEDDING_SPACES, requireEmbeddingSpace } from './space.ts';
import { parseRetryAfter } from './openai.ts';
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

test('preflight snapshots text: caller mutation between batches cannot alter billed inputs', async () => {
  const originals=fixtureChunks(129);
  const originalLast=originals[128].text;
  let call=0;
  const provider=fakeProvider(async inputs => {
    call++;
    if(call===1) (originals[128] as { text: string }).text='X'.repeat(5000);
    if(call===2) assert.equal(inputs[0],originalLast);
    return {vectors:inputs.map(()=>[...VALID_VECTOR]),usage:{tokens:inputs.length}};
  });
  const result=await embedMissingDocumentChunks(args(originals,provider));
  assert.equal(call,2);
  assert.equal(result.providerCalls,2);
  assert.equal(result.embedded.length,129);
  assert.ok(result.reservedTokenUpperBound<=result.plan.worstCaseTokenReservation);
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

test('legacy byte estimate keeps its UTF-8 padding', () => {
  const tokens = conservativeInputTokenUpperBound('Árvore');
  assert.ok(tokens > Buffer.byteLength('Árvore'));
});
