import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { documentId, sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { RagProcessingError } from './errors.ts';
import { processFetchedDocumentOffline } from './index.ts';
import {
  auditH9PinnedSyntheticChunks, countH9Cl100kTokens, H9_PINNED_COUNTER,
  H9_PINNED_TOKENIZER,
} from './cl100k-counter.ts';

const source = SOURCE_MANIFEST[0];

function bad(fn: () => unknown): void {
  assert.throws(fn, e =>
    e instanceof RagProcessingError &&
    e.code === 'INVALID_DOCUMENT' &&
    e.message === 'INVALID_DOCUMENT');
}

/**
 * Independent OpenAI tiktoken reference:
 * https://github.com/openai/tiktoken/blob/main/tests/test_encoding.py
 * enc.encode('hello world') -> [15339, 1917]
 */
test('H9B pinned cl100k_base matches independent golden counts', () => {
  assert.equal(countH9Cl100kTokens('hello world'), 2);
  assert.equal(countH9Cl100kTokens('Hello, world!'), 4);
  assert.equal(countH9Cl100kTokens('hello world'), 2);
  assert.equal(H9_PINNED_TOKENIZER.encoding, 'cl100k_base');
  assert.equal(H9_PINNED_TOKENIZER.version, '1.0.21');
  assert.equal(H9_PINNED_TOKENIZER.liveAdmissionApproved, false);
});

test('H9B uses full synthetic Step C embedding inputs including context header', () => {
  const html = readFileSync(new URL('./fixtures/synthetic-lgpd.html', import.meta.url));
  const fetched: FetchedDocument = {
    sourceId: source.sourceId,
    documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
    canonicalUri: source.canonicalUri,
    finalUri: source.canonicalUri,
    httpStatus: 200,
    declaredMediaType: 'text/html; charset=utf-8',
    sniffedMediaType: 'text/html',
    charset: 'utf-8',
    byteSize: html.byteLength,
    contentSha256: sha256(html),
    fetchedAt: '2026-11-23T00:00:00.000Z',
    bytes: html,
  };
  const old = processFetchedDocumentOffline(fetched, source).chunkSet;
  assert.ok(old.chunks.length > 0);
  assert.equal(old.tokenizer, 'utf8-byte-proxy@1');
  const audit = auditH9PinnedSyntheticChunks(old.chunks);
  const directSum = old.chunks.reduce((n, c) => n + countH9Cl100kTokens(c.content), 0);
  assert.equal(audit.observedTokens.total, directSum);
  assert.equal(audit.sampleCount, old.chunks.length);
  assert.equal(audit.counterTrust, 'injected-unverified');
  assert.equal(audit.evidenceClass, 'synthetic-fixture-only');
  assert.equal(audit.liveAdmissionApproved, false);
  assert.ok(audit.observedTokens.max > 0);
  // Audit must not change existing proxy chunk identities.
  assert.equal(old.chunkSetId, processFetchedDocumentOffline(fetched, source).chunkSet.chunkSetId);
  assert.ok(old.chunks.some(c => c.content.includes('\n---\n')));
  assert.equal(JSON.stringify(audit).includes('Art. 5º'), false);
  assert.equal(JSON.stringify(audit).includes(source.canonicalUri), false);
});

test('H9B offline counter validates strings and fails closed without raw errors', () => {
  for (const value of ['', ' ', '\uD800', '\uDC00', 'x'.repeat(32769)]) {
    bad(() => countH9Cl100kTokens(value));
  }
  assert.ok(countH9Cl100kTokens('Art. 5º, II, § 3º – ação administrativa') > 0);
  assert.ok(countH9Cl100kTokens('Texto com caracteres Unicode 🧪 e acentuação.') > 0);
  assert.equal(H9_PINNED_COUNTER.countTokens('hello world'), 2);
  assert.equal(H9_PINNED_COUNTER.encoding, 'cl100k_base');
});

test('H9B audit does not authorize provider usage or claim official-corpus provenance', () => {
  const report = auditH9PinnedSyntheticChunks([
    { id: 'a'.repeat(64), content: 'Art. 7º: Texto jurídico inventado para teste.' },
  ]);
  assert.equal(report.liveAdmissionApproved, false);
  assert.equal(report.evidenceClass, 'synthetic-fixture-only');
  assert.equal(report.counterTrust, 'injected-unverified');
  assert.ok(report.bytePlusEightProxy.total >= 1);
  bad(() => auditH9PinnedSyntheticChunks([{ id: 'x', content: 'Dados pessoais' }]));
});
