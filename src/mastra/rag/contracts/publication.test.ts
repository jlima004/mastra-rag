import assert from 'node:assert/strict';
import test from 'node:test';
import { RagContractError } from './errors.ts';
import { assessRenderedPublication } from './publication.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const t1 = '2026-11-17T12:00:00.000Z';
const t2 = '2026-11-17T12:10:00.000Z';
const t3 = '2026-11-17T12:20:00.000Z';

test('new document candidate publishes; pure evaluator never writes anything', () => {
  assert.deepEqual(assessRenderedPublication(null, { chunkSetId: A, fetchedAt: t1 }),
    { outcome: 'publish', advanceWatermark: false });
});

test('the same rendered chunk set is the only automatic no-op, advancing freshness when newer', () => {
  const current = { chunkSetId: A, versionFetchedAt: t2 };
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: A, fetchedAt: t3 }),
    { outcome: 'no_op', advanceWatermark: true });
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: A, fetchedAt: t1 }),
    { outcome: 'no_op', advanceWatermark: false });
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: A, fetchedAt: t2 }),
    { outcome: 'no_op', advanceWatermark: false });
});

test('different rendered set, even with same normalized text, is not a no-op', () => {
  const current = { chunkSetId: A, versionFetchedAt: t1 };
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: B, fetchedAt: t2 }),
    { outcome: 'publish', advanceWatermark: false });
});

test('new observation wins for content reversion; old racing observation is stale', () => {
  const current = { chunkSetId: B, versionFetchedAt: t2 };
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: A, fetchedAt: t3 }),
    { outcome: 'publish', advanceWatermark: false });
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: C, fetchedAt: t1 }),
    { outcome: 'stale', advanceWatermark: false });
});

test('equal fetch time breaks ties deterministically by rendered set ID', () => {
  const current = { chunkSetId: B, versionFetchedAt: t2 };
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: A, fetchedAt: t2 }),
    { outcome: 'stale', advanceWatermark: false });
  assert.deepEqual(assessRenderedPublication(current, { chunkSetId: C, fetchedAt: t2 }),
    { outcome: 'publish', advanceWatermark: false });
});

test('rejects unknown IDs and malformed timestamps without revealing input', () => {
  for (const action of [
    () => assessRenderedPublication(null, { chunkSetId: 'BAD', fetchedAt: t2 }),
    () => assessRenderedPublication({ chunkSetId: A, versionFetchedAt: 'wrong' },
      { chunkSetId: B, fetchedAt: t2 }),
    () => assessRenderedPublication(null, { chunkSetId: A, fetchedAt: '2026-11-17' }),
    () => assessRenderedPublication(null, { chunkSetId: A, fetchedAt: 'nope' }),
  ]) {
    assert.throws(action, (error: unknown) =>
      error instanceof RagContractError &&
      error.code === 'INVALID_HASH_COMPONENT' &&
      error.message === 'INVALID_HASH_COMPONENT');
  }
});
