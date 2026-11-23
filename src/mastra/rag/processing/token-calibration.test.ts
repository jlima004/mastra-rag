import assert from 'node:assert/strict';
import test from 'node:test';
import { RagProcessingError } from './errors.ts';
import {
  auditH9OfflineTokenCounts, H9_ENCODING, H9_MAX_AUDIT_INPUT_CHARS,
  type H9CalibrationInput, type H9InjectedTokenCounter,
} from './token-calibration.ts';

function sample(letter: string, content: string): H9CalibrationInput {
  return Object.freeze({ id: letter.repeat(64), content });
}

function fakeCounter(fn: (input: string) => number): H9InjectedTokenCounter {
  return Object.freeze({ encoding: H9_ENCODING, countTokens: fn });
}

function invalid(call: () => unknown): void {
  assert.throws(call, (error: unknown) =>
    error instanceof RagProcessingError &&
    error.code === 'INVALID_DOCUMENT' &&
    error.message === 'INVALID_DOCUMENT');
}

test('H9 audit counts full embedding content including header, not just body', () => {
  const chunk = sample('a', 'LGPD › Capítulo II › Art. 7º\n---\nConteúdo sintético.');
  const calls: string[] = [];
  const result = auditH9OfflineTokenCounts([chunk], fakeCounter(input => {
    calls.push(input);
    return input.includes('LGPD ›') && input.includes('\n---\n') ? 17 : 1;
  }));

  assert.deepEqual(calls, [chunk.content]);
  assert.equal(result.observedTokens.total, 17);
  assert.equal(result.observedTokens.p50, 17);
  assert.equal(result.observedTokens.p95, 17);
  assert.equal(result.bytePlusEightProxy.total, Buffer.byteLength(chunk.content, 'utf8') + 8);
  assert.equal(result.evidenceClass, 'synthetic-fixture-only');
  assert.equal(result.counterTrust, 'injected-unverified');
  assert.equal(result.liveAdmissionApproved, false);
  assert.equal(result.encodingClaim, H9_ENCODING);
  assert.equal(JSON.stringify(result).includes('Conteúdo sintético'), false);
  assert.equal(JSON.stringify(result).includes(chunk.id), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.observedTokens), true);
});

test('H9 threshold grid is strict greater-than; p50/p95 nearest-rank', () => {
  const chunks = [
    sample('a', 'Um'), sample('b', 'Dois'),
    sample('c', 'Três'), sample('d', 'Quatro'),
  ];
  const readings = new Map([['Um', 256], ['Dois', 512], ['Três', 1024], ['Quatro', 1025]]);
  const result = auditH9OfflineTokenCounts(chunks, fakeCounter(input => readings.get(input) ?? 0));
  assert.deepEqual(result.exceedsTokenGrid, { over256: 3, over512: 2, over1024: 1 });
  assert.equal(result.exceedsProviderInputCap8191, 0);
  assert.equal(result.observedTokens.total, 2817);
  assert.equal(result.observedTokens.p50, 512);
  assert.equal(result.observedTokens.p95, 1025);
  assert.equal(result.observedTokens.max, 1025);
  assert.equal(result.byteProxyUndercountSamples, 4);
  assert.ok(result.maxByteProxyUndercountTokens > 0);
});

test('H9 audit detects a provider-cap violation, but never grants paid admission', () => {
  const report = auditH9OfflineTokenCounts(
    [sample('c', 'Conteúdo demonstrativo')],
    fakeCounter(() => 8192),
  );
  assert.equal(report.exceedsProviderInputCap8191, 1);
  assert.equal(report.exceedsTokenGrid.over1024, 1);
  assert.equal(report.liveAdmissionApproved, false);
});

test('H9 audit rejects empty, duplicate, malformed or oversized inputs', () => {
  const valid = sample('a', 'Texto sintético');
  const counter = fakeCounter(() => 2);
  invalid(() => auditH9OfflineTokenCounts([], counter));
  invalid(() => auditH9OfflineTokenCounts([valid, valid], counter));
  invalid(() => auditH9OfflineTokenCounts([sample('g', 'Texto')], counter));
  invalid(() => auditH9OfflineTokenCounts([sample('b', ' ')], counter));
  invalid(() => auditH9OfflineTokenCounts([sample('b', '\uD800')], counter));
  invalid(() => auditH9OfflineTokenCounts([sample('b', '\uDC00')], counter));
  invalid(() => auditH9OfflineTokenCounts([sample('b', 'x'.repeat(H9_MAX_AUDIT_INPUT_CHARS + 1))], counter));
  invalid(() => auditH9OfflineTokenCounts(Array.from(
    { length: 2001 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), content: 'A' })
  ), counter));
});

test('H9 audit fails closed on misleading or throwing injected token counters', () => {
  const s = [sample('a', 'Dado confidencial sintético')];
  invalid(() => auditH9OfflineTokenCounts(s, { encoding: 'wrong' as 'cl100k_base', countTokens: () => 1 }));
  for (const bad of [0, -1, 1.5, NaN, Infinity, 2_000_001]) {
    invalid(() => auditH9OfflineTokenCounts(s, fakeCounter(() => bad)));
  }
  invalid(() => auditH9OfflineTokenCounts(s, fakeCounter(() => {
    throw new Error('Never expose input or secret');
  })));
});

test('H9 analysis cannot infer official-corpus verification or persistence from a fake counter', () => {
  const report = auditH9OfflineTokenCounts(
    [sample('f', 'Art. 5º, II — unidade inventada para teste.')],
    fakeCounter(() => 10),
  );
  assert.equal(report.evidenceClass, 'synthetic-fixture-only');
  assert.equal(report.counterTrust, 'injected-unverified');
  assert.equal(report.liveAdmissionApproved, false);
  assert.equal(report.exceedsJobCap, false);
  assert.deepEqual(report.exceedsTokenGrid, { over256: 0, over512: 0, over1024: 0 });
});
