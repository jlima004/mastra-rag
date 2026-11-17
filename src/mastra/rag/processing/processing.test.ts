import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sha256, documentId } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { RAG_LIMITS, type FetchedDocument } from '../contracts/types.ts';
import { decodeFetchedDocument, detectDocumentCharset } from './decode.ts';
import { RagProcessingError } from './errors.ts';
import { extractHtmlBlocks, extractTextBlocks } from './html.ts';
import { parseArticleLocator, normalizeLegalBlocks } from './legal.ts';
import {
  makeOfflineChunkSet, RECURSIVE_PROXY_CONFIG, STRUCTURAL_PROXY_CONFIG,
} from './chunk.ts';
import { processFetchedDocumentOffline } from './index.ts';

const source = SOURCE_MANIFEST[0];
const html = readFileSync(new URL('./fixtures/synthetic-lgpd.html', import.meta.url));
const fixedTime = '2026-11-16T12:00:00.000Z';

function fixture(bytes: Uint8Array = html, media: 'text/html' | 'text/plain' = 'text/html'): FetchedDocument {
  return {
    sourceId: source.sourceId,
    documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
    canonicalUri: source.canonicalUri,
    finalUri: source.canonicalUri,
    httpStatus: 200,
    declaredMediaType: media + '; charset=utf-8',
    sniffedMediaType: media,
    charset: 'utf-8',
    byteSize: bytes.byteLength,
    contentSha256: sha256(bytes),
    fetchedAt: fixedTime,
    bytes,
  };
}
function errorCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) =>
    e instanceof RagProcessingError && e.code === code && e.message === code);
}

test('synthetic HTML only: scripts, navigation, revoked text and signatures never survive', () => {
  const result = processFetchedDocumentOffline(fixture(), source);
  const text = result.normalized.normalizedText;
  for (const forbidden of [
    'THIS SCRIPT MUST NOT APPEAR', 'Menu não normativo',
    'dispositivo revogado que não deve aparecer', 'Assinatura e navegação',
    'Art. 9º (Revogado)',
  ]) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(text.includes('Art. 5º'), true);
  assert.equal(text.includes('Redação dada'), true);
  assert.equal(result.normalized.blocks.some(b => b.annotations.length > 0), true);
  assert.equal(result.normalized.normalizedSha256, sha256(text));
});

test('legal hierarchy includes chapter and stable article, inciso, paragraph locators', () => {
  const normalized = processFetchedDocumentOffline(fixture(), source).normalized;
  for (const locator of ['lgpd:art5','lgpd:art5:inc1','lgpd:art5:inc2',
    'lgpd:art55-j', 'lgpd:art55-j:par3','lgpd:art1:parunico']) {
    assert.ok(normalized.blocks.some(b => b.locator === locator), locator);
  }
  assert.equal(parseArticleLocator('Art. 55-J. Exercício.', 'lgpd'), 'lgpd:art55-j');
  assert.equal(parseArticleLocator('Art. 7º Garantias.', 'lgpd'), 'lgpd:art7');
  assert.equal(parseArticleLocator('Art. 7o Garantias.', 'lgpd'), 'lgpd:art7');
  assert.equal(normalized.blocks.find(b => b.locator === 'lgpd:art5:inc2')?.headingPath[0], 'CAPÍTULO I');
});

test('UTF-16 slice offsets reconstruct every normalized block and emitted body exactly', () => {
  const { normalized, chunkSet } = processFetchedDocumentOffline(fixture(), source);
  for (const b of normalized.blocks) {
    assert.equal(normalized.normalizedText.slice(b.start, b.end), b.text);
  }
  for (const chunk of chunkSet.chunks) {
    assert.equal(normalized.normalizedText.slice(chunk.charStart, chunk.charEnd), chunk.body);
    assert.ok(chunk.legalUnitIds.length > 0);
    assert.equal(chunk.content.endsWith(chunk.body), true);
  }
});

test('determinism across runs, byte cap and source revision', () => {
  const first = processFetchedDocumentOffline(fixture(), source);
  const second = processFetchedDocumentOffline(fixture(), source);
  assert.deepEqual(first, second);
  assert.ok(first.chunkSet.chunks.every(c => c.byteCount <= STRUCTURAL_PROXY_CONFIG.maxBytes));
  assert.ok(first.chunkSet.chunks.length > 0);
  const changed = Buffer.from(html.toString('utf8').replace('fictícia', 'imaginária'));
  const changedSet = processFetchedDocumentOffline(fixture(changed), source).chunkSet;
  assert.notEqual(changedSet.chunkSetId, first.chunkSet.chunkSetId);
  assert.equal(first.chunkSet.tokenizer, 'utf8-byte-proxy@1');
  assert.equal(first.chunkSet.totalByteBudget, first.chunkSet.chunks.reduce((a,c) => a+c.byteCount,0));
  console.log('RAG09_SYNTHETIC_BYTE_PROXY_STATS=' + JSON.stringify({
    chunks: first.chunkSet.chunks.length,
    minBytes: Math.min(...first.chunkSet.chunks.map(c => c.byteCount)),
    maxBytes: Math.max(...first.chunkSet.chunks.map(c => c.byteCount)),
    totalBytes: first.chunkSet.totalByteBudget,
    source: 'synthetic-not-official',
  }));
});

test('large single legal unit splits without byte overflow or surrogate corruption', () => {
  const longHtml = '<!doctype html><html><body><p>Art. 10. ' +
    ('A proteção às informações sintéticas permanece necessária. '.repeat(180)) +
    '</p></body></html>';
  const result = processFetchedDocumentOffline(fixture(Buffer.from(longHtml)), source);
  assert.ok(result.chunkSet.chunks.length > 2);
  assert.ok(result.chunkSet.chunks.every(c => c.byteCount <= 512));
  assert.ok(result.chunkSet.chunks.every(c => c.legalUnitIds.includes('lgpd:art10')));
});

test('header selection reserves separator plus eight body bytes at 499/500/505 bytes', () => {
  const sourceTitle = source.title;
  const prefix = sourceTitle + ' › CAPÍTULO ';
  const suffix = ' › lgpd:art42';
  const fixedHeaderBytes = Buffer.byteLength(prefix + suffix, 'utf8');
  for (const targetBytes of [499, 500, 505]) {
    const heading = 'CAPÍTULO ' + 'X'.repeat(targetBytes - fixedHeaderBytes);
    const normalized = normalizeLegalBlocks([
      { kind: 'heading', text: heading },
      { kind: 'text', text: 'Art. 42. Esta regra sintética contém um texto com várias frases. Uma nova frase.' },
    ], source);
    const set = makeOfflineChunkSet(normalized, fixture(), source);
    assert.ok(set.chunks.length >= 1, String(targetBytes));
    assert.ok(set.chunks.every(c => c.byteCount <= 512), String(targetBytes));
    assert.ok(set.chunks.every(c => normalized.normalizedText.slice(c.charStart, c.charEnd) === c.body));
    if (targetBytes >= 500) {
      // Breadcrumb is too large, but the shorter locator-only header works.
      assert.ok(set.chunks.every(c => c.content.startsWith('lgpd:art42\n---\n')), String(targetBytes));
    }
  }
});

test('metadata-only title changes alter rendered chunk IDs, not source version or reusable profile', () => {
  const first = processFetchedDocumentOffline(fixture(), source);
  const renamed = { ...source, title: source.title + ' — título atualizado' };
  const second = processFetchedDocumentOffline(fixture(), renamed);
  assert.equal(first.normalized.normalizedSha256, second.normalized.normalizedSha256);
  assert.equal(first.chunkSet.versionId, second.chunkSet.versionId);
  assert.equal(first.chunkSet.profileId, second.chunkSet.profileId);
  assert.notEqual(first.chunkSet.headerMetadataSha256, second.chunkSet.headerMetadataSha256);
  assert.notEqual(first.chunkSet.chunkSetId, second.chunkSet.chunkSetId);
  assert.notDeepEqual(first.chunkSet.chunks.map(c => c.content), second.chunkSet.chunks.map(c => c.content));
  assert.ok(first.chunkSet.chunks.every((c, i) => c.id !== second.chunkSet.chunks[i]?.id));
  assert.deepEqual(first.chunkSet, processFetchedDocumentOffline(fixture(), source).chunkSet);
  const recursiveFirst = makeOfflineChunkSet(first.normalized, fixture(), source, RECURSIVE_PROXY_CONFIG);
  const recursiveRenamed = makeOfflineChunkSet(second.normalized, fixture(), renamed, RECURSIVE_PROXY_CONFIG);
  assert.equal(recursiveFirst.chunkSetId, recursiveRenamed.chunkSetId);
});

test('recursive calibration baseline has deterministic overlapping byte-budget windows', () => {
  const { normalized } = processFetchedDocumentOffline(fixture(), source);
  const set = makeOfflineChunkSet(normalized, fixture(), source, RECURSIVE_PROXY_CONFIG);
  assert.ok(set.chunks.length > 1);
  assert.ok(set.chunks.every(c => c.byteCount <= 400));
  assert.ok(set.chunks.every(c => normalized.normalizedText.slice(c.charStart,c.charEnd)===c.body));
  for (let i=1; i<set.chunks.length; i++) {
    assert.ok(set.chunks[i].charStart < set.chunks[i-1].charEnd);
    assert.ok(set.chunks[i].charEnd > set.chunks[i-1].charEnd);
  }
});

test('no permissive decoding when bytes, SHA, status or charset disagree', () => {
  errorCode(() => decodeFetchedDocument({...fixture(), contentSha256: '0'.repeat(64)},source), 'INVALID_DOCUMENT');
  errorCode(() => decodeFetchedDocument({...fixture(), byteSize: -1},source), 'INVALID_DOCUMENT');
  errorCode(() => decodeFetchedDocument({...fixture(), httpStatus: 404 as 200},source), 'INVALID_DOCUMENT');
  errorCode(() => decodeFetchedDocument({...fixture(), charset: 'iso-8859-1'},source), 'DECODE_INVALID_CHARSET');
  errorCode(() => detectDocumentCharset(
    'text/html; charset=utf-8',
    Buffer.from('<meta charset="iso-8859-1">'),
    'text/html'), 'DECODE_CHARSET_CONFLICT');
});

test('supports Windows-1252 legacy HTML without corrupting characters', () => {
  const legacy = Buffer.from([60,104,116,109,108,62,60,112,62,65,231,227,111,60,47,112,62,60,47,104,116,109,108,62]);
  const fetched = { ...fixture(legacy), declaredMediaType:'text/html; charset=iso-8859-1', charset:'windows-1252' };
  assert.match(decodeFetchedDocument(fetched,source), /Ação/);
});

test('fail-closed handling for malformed HTML and unknown entities', () => {
  errorCode(() => extractHtmlBlocks('<html><p>&noSuchEntity;</p></html>'), 'EXTRACT_UNSUPPORTED_ENTITY');
  errorCode(() => extractHtmlBlocks('<html><p></p></html>'), 'EXTRACT_EMPTY');
  errorCode(() => extractHtmlBlocks('<html><p>Hi</p><script>missing close'), 'EXTRACT_UNSUPPORTED_HTML');
  errorCode(() => extractTextBlocks('   ', 'text/plain'), 'EXTRACT_EMPTY');
});

test('normalizer enforces the approved character cap', () => {
  const tooBig = 'Art. 8º ' + 'X'.repeat(RAG_LIMITS.MAX_NORMALIZED_CHARS);
  errorCode(() => normalizeLegalBlocks([{kind:'text',text:tooBig}],source), 'NORMALIZED_TOO_LARGE');
});
