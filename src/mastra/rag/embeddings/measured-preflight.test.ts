import assert from 'node:assert/strict';
import test from 'node:test';
import { countH9Cl100kTokens } from '../processing/cl100k-counter.ts';
import { inspectEmbeddingFailure, inspectEmbeddingResponse } from './durable-budget.ts';
import { RagEmbeddingError } from './errors.ts';
import { conservativeInputTokenUpperBound } from './job.ts';
import { E2_MEASURED_TOKENIZER, prepareMeasuredEmbeddingPlan } from './measured-preflight.ts';
import type { EmbeddingProvider } from './provider.ts';

const provider: EmbeddingProvider = {
  spaceId: 'chunks_te3s_1536_v1',
  dimension: 1536,
  maxInputsPerCall: 128,
  maxInputTokens: 8191,
  async embed() {
    throw new Error('The provider is outside preflight');
  },
};

const input = (text: string, key = 'a') => ({ chunkId: key.repeat(64), text });

test('S512 counts the full rendered text and admits multibyte input rejected by byte-proxy', () => {
  const heading = 'Resolução › Capítulo I › Art. 1º\n---\n';
  const body = ' informação'.repeat(150);
  const chunk = { ...input(heading + body), tokens: 1 };
  const planned = prepareMeasuredEmbeddingPlan(provider, [chunk]);
  const { batches: [batch], totalTokens, worstCaseTokenReservation } = planned;
  assert.equal(planned.measuredTokenizer, E2_MEASURED_TOKENIZER);
  assert.equal(totalTokens, countH9Cl100kTokens(heading + body));
  assert.notEqual(totalTokens, countH9Cl100kTokens(body));
  assert.ok(totalTokens > 1 && totalTokens <= 512);
  assert.ok(conservativeInputTokenUpperBound(chunk.text) > 1024);
  assert.equal(batch.chunks[0].bytes, Buffer.byteLength(chunk.text));
  assert.equal(worstCaseTokenReservation, 4 * totalTokens);
  assert.equal(batch.chunks[0].text, chunk.text);
  chunk.text = 'alterado';
  assert.notEqual(batch.chunks[0].text, chunk.text);
  assert.notEqual(
    batch.hash, prepareMeasuredEmbeddingPlan(provider, [chunk]).batches[0].hash,
  );
});

test('preflight enforces S512 and provider ceilings, including for reused chunks', () => {
  const invalidInput = { code: 'EMBED_INVALID_INPUT' };
  for (const text of ['', '   ', '\uD800', '\uDC00', 'zero\0byte', ' x'.repeat(513)]) {
    const candidate = input(text);
    assert.throws(() => prepareMeasuredEmbeddingPlan(provider, [candidate], [candidate.chunkId]), invalidInput);
  }
  const chunk = input('two tokens');
  assert.throws(() => prepareMeasuredEmbeddingPlan({ ...provider, maxInputTokens: 1 }, [chunk]), invalidInput);
  assert.throws(() => prepareMeasuredEmbeddingPlan(provider, [chunk, chunk]), invalidInput);
  assert.throws(() => prepareMeasuredEmbeddingPlan(provider, [chunk], ['wrong id']), invalidInput);
  const reused = prepareMeasuredEmbeddingPlan(provider, [chunk], [chunk.chunkId]);
  assert.equal(reused.chunks[0].tokens, 2);
  assert.equal(reused.batches.length, 0);
  assert.equal(reused.worstCaseTokenReservation, 0);
});

test('batch plan honors provider limits and counts three retries for the largest batch globally', () => {
  const first = input('one two three');
  const second = input('one', 'b');
  const plan = prepareMeasuredEmbeddingPlan({ ...provider, maxInputsPerCall: 1 }, [first, second]);
  assert.deepEqual(plan.batches.map(batch => batch.tokens), [3, 1]);
  assert.equal(plan.worstCaseTokenReservation, 13);
});

test('response inspection retains overage and valid usage with invalid vectors', () => {
  const batch = prepareMeasuredEmbeddingPlan(provider, [input('one two')]).batches[0];
  const vectors = [Array.from({ length: 1536 }, () => 0.01)];
  assert.deepEqual(inspectEmbeddingResponse({ vectors, usage: { tokens: 2 } }, batch),
    { state: 'succeeded', vectors, reportedTokens: 2 });
  assert.deepEqual(inspectEmbeddingResponse({ usage: { tokens: 5 } }, batch),
    { state: 'overage', reportedTokens: 5 });
  for (const tokens of [undefined, 0, -1, Number.NaN, '2']) {
    assert.deepEqual(inspectEmbeddingResponse({ vectors, usage: { tokens } }, batch),
      { state: 'unknown', errorCode: 'EMBED_USAGE_INVALID' });
  }
  for (const [invalid, code] of [
    [[[0.5]], 'EMBED_DIMENSION_MISMATCH'],
    [[vectors[0].map(() => Number.NaN)], 'EMBED_NONFINITE_VECTOR'],
    [[vectors[0].map(() => 1e150)], 'EMBED_NONFINITE_VECTOR'],
  ] as const) {
    assert.deepEqual(inspectEmbeddingResponse({ vectors: invalid, usage: { tokens: 1 } }, batch),
      { state: 'invalid', reportedTokens: 1, errorCode: code });
  }
});

test('retry policy preserves a bounded Retry-After and classifies timeout as unknown', () => {
  const started = { state: 'started', attemptId: 'attempt', retriesUsed: 0, reservedTokens: 10, callLimitReached: false, utcDay: '2026-11-27' } as const;
  const transient = new RagEmbeddingError('EMBED_PROVIDER_TRANSIENT', { retryable: true, retryAfterMs: 2000 });
  assert.deepEqual(inspectEmbeddingFailure(transient, started, () => 0),
    { state: 'retryable', delayMs: 2000, errorCode: 'EMBED_PROVIDER_TRANSIENT' });
  assert.deepEqual(inspectEmbeddingFailure(transient, { ...started, retriesUsed: 3 }, () => 0),
    { state: 'unknown', errorCode: 'EMBED_RETRY_EXHAUSTED' });
  assert.deepEqual(inspectEmbeddingFailure(new Error('private provider timeout'), started),
    { state: 'unknown', errorCode: 'EMBED_PROVIDER_FAILURE' });
});
