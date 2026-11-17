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
  makeOfflineChunkSet, renderAwareChunkSetId, RECURSIVE_PROXY_CONFIG, STRUCTURAL_PROXY_CONFIG,
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
  assert.equal(first.chunkSet.renderingIdentityVersion, 'rag:chunkset-rendered:v2');
  assert.equal(first.chunkSet.normalizedSha256, first.normalized.normalizedSha256);
  assert.equal(first.chunkSet.chunkSetId, renderAwareChunkSetId(
    first.chunkSet.baseChunkSetId, first.chunkSet.normalizedSha256,
    first.chunkSet.headerMetadataSha256,
  ));
  assert.ok(Object.isFrozen(first.chunkSet));
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

test('normative article presented as h2 remains an article and preserves caput and inciso', () => {
  const synthetic = '<!doctype html><html><body>' +
    '<h2>CAPÍTULO TESTE</h2>' +
    '<h2>Art. 7º O tratamento só é permitido com consentimento.</h2>' +
    '<p>I - A primeira condição sintética.</p>' +
    '<p>II - A segunda condição sintética.</p>' +
    '</body></html>';
  const { normalized, chunkSet } = processFetchedDocumentOffline(fixture(Buffer.from(synthetic)), source);
  const article = normalized.blocks.find(b => b.locator === 'lgpd:art7');
  assert.equal(article?.kind, 'article');
  assert.equal(article?.articleLocator, 'lgpd:art7');
  assert.deepEqual(normalized.blocks.filter(b => b.kind === 'inciso').map(b => b.locator),
    ['lgpd:art7:inc1', 'lgpd:art7:inc2']);
  assert.ok(chunkSet.chunks.some(c => c.body.includes('Art. 7º O tratamento só é permitido')));
  assert.ok(chunkSet.chunks.some(c => c.legalUnitIds.includes('lgpd:art7:inc1')));
  assert.ok(chunkSet.chunks.some(c => c.legalUnitIds.includes('lgpd:art7:inc2')));
  assert.ok(chunkSet.chunks.every(c => !c.legalUnitIds.includes('lgpd:preambulo')));
  for (const b of normalized.blocks.filter(b => b.articleLocator === 'lgpd:art7')) {
    assert.ok(chunkSet.chunks.some(c => c.charStart <= b.start && c.charEnd >= b.end),
      'normative unit omitted: ' + b.locator);
  }
});

test('30 short legal children pack greedily without mixing articles or losing offsets', () => {
  const children = Array.from({ length: 30 }, (_, i) =>
    '<p>§ ' + (i + 1) + 'º A condição sintética número ' + (i + 1) + ' permanece válida.</p>');
  const html = '<!doctype html><html><body>' +
    '<p>Art. 10. Caput sintético para o teste de agrupamento.</p>' +
    children.join('') +
    '<p>Art. 11. Outro artigo, não misturar os grupos.</p>' +
    '<p>I - Inciso pertencente ao artigo 11.</p></body></html>';
  const fetched = fixture(Buffer.from(html));
  const { normalized, chunkSet } = processFetchedDocumentOffline(fetched, source);
  const firstArticle = chunkSet.chunks.filter(c => c.articleLocator === 'lgpd:art10');
  const secondArticle = chunkSet.chunks.filter(c => c.articleLocator === 'lgpd:art11');
  assert.ok(firstArticle.length >= 2 && firstArticle.length < 16,
    '30 short paragraphs must be greedily packed, not emitted individually');
  assert.ok(secondArticle.length >= 1);
  assert.equal(firstArticle.some(c => c.body.includes('Art. 11.')), false);
  assert.equal(secondArticle.some(c => c.body.includes('Art. 10.')), false);
  assert.ok(firstArticle.some(c => c.legalUnitIds.length >= 3),
    'one packed chunk must contain multiple consecutive legal units');
  for (const c of chunkSet.chunks) {
    assert.equal(normalized.normalizedText.slice(c.charStart, c.charEnd), c.body);
    assert.ok(c.byteCount <= STRUCTURAL_PROXY_CONFIG.maxBytes);
    assert.ok(!c.legalUnitIds.some(id => id.startsWith('lgpd:art10')) ||
      !c.legalUnitIds.some(id => id.startsWith('lgpd:art11')));
  }
  for (const block of normalized.blocks.filter(b => b.articleLocator)) {
    assert.ok(chunkSet.chunks.some(c => c.charStart <= block.start && c.charEnd >= block.end),
      'unit omitted or split unnecessarily: ' + block.locator);
  }
  assert.deepEqual(chunkSet, processFetchedDocumentOffline(fetched, source).chunkSet);
});

test('oversized single child is split, while neighboring short children remain grouped', () => {
  const html = '<!doctype html><html><body>' +
    '<p>Art. 12. Caput sintético.</p>' +
    '<p>§ 1º Primeiro parágrafo curto.</p>' +
    '<p>§ 2º ' + 'Texto jurídico sintético longo com unicode é á ç. '.repeat(50) + '</p>' +
    '<p>§ 3º Terceiro parágrafo curto.</p>' +
    '<p>§ 4º Quarto parágrafo curto.</p>' +
    '</body></html>';
  const { normalized, chunkSet } = processFetchedDocumentOffline(fixture(Buffer.from(html)), source);
  assert.ok(chunkSet.chunks.length > 2);
  assert.ok(chunkSet.chunks.every(c => c.byteCount <= STRUCTURAL_PROXY_CONFIG.maxBytes));
  assert.ok(chunkSet.chunks.some(c => c.body.includes('§ 3º') && c.body.includes('§ 4º')),
    'neighboring short children should be packed after a split');
  assert.ok(chunkSet.chunks.every(c =>
    normalized.normalizedText.slice(c.charStart, c.charEnd) === c.body));
  assert.ok(chunkSet.chunks.every(c => c.legalUnitIds.includes('lgpd:art12')));
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
  assert.equal(first.chunkSet.baseChunkSetId, second.chunkSet.baseChunkSetId);
  assert.equal(first.chunkSet.normalizedSha256, second.chunkSet.normalizedSha256);
  assert.equal(first.chunkSet.headerMetadataSha256,
    sha256(first.chunkSet.headerMetadataCanonicalJson!));
  assert.notEqual(first.chunkSet.headerMetadataCanonicalJson, second.chunkSet.headerMetadataCanonicalJson);
  assert.notEqual(first.chunkSet.headerMetadataSha256, second.chunkSet.headerMetadataSha256);
  assert.notEqual(first.chunkSet.chunkSetId, second.chunkSet.chunkSetId);
  assert.notDeepEqual(first.chunkSet.chunks.map(c => c.content), second.chunkSet.chunks.map(c => c.content));
  assert.ok(first.chunkSet.chunks.every((c, i) => c.id !== second.chunkSet.chunks[i]?.id));
  assert.deepEqual(first.chunkSet, processFetchedDocumentOffline(fixture(), source).chunkSet);
  const recursiveFirst = makeOfflineChunkSet(first.normalized, fixture(), source, RECURSIVE_PROXY_CONFIG);
  const recursiveRenamed = makeOfflineChunkSet(second.normalized, fixture(), renamed, RECURSIVE_PROXY_CONFIG);
  assert.equal(recursiveFirst.chunkSetId, recursiveRenamed.chunkSetId);
  assert.equal(recursiveFirst.headerMetadataCanonicalJson, null);
  assert.equal(recursiveFirst.headerMetadataSha256, null);
});

test('render-aware v2 IDs have an independent exact SHA-256 golden fixture', () => {
  const base = 'b4a9270040ae6fa2c209abd8708420f6b5013128c7fc524b69dd38d5fffaed9a';
  const normalized = '5cf495ae102baa58b889e5756c4a505d26dd83e95533bdba1dfb8057b6549ce5';
  const header = 'fede69a06288c13d06a2e12e4f69ad3b762a81774516fdab98174ba539e8e890';
  assert.equal(
    renderAwareChunkSetId(base, normalized, header),
    'dbdafcf3d02e284af0c99446784338ae3b268c5f1c9aadc00a25487250f8f894',
  );
  assert.equal(
    renderAwareChunkSetId(base, normalized, null),
    '6f3b965b39cc698395ed4cbd730e27758042ba8e63a332589b6a6625108b97b1',
  );
});

test('identical raw bytes decoded with different HTTP charsets cannot reuse chunk IDs', () => {
  const raw = Buffer.from(
    '<!doctype html><html><body><p>Art. 7º A proteção de dados é sintética.</p></body></html>',
    'utf8',
  );
  const base = fixture(raw);
  const utf8 = { ...base, declaredMediaType: 'text/html; charset=utf-8', charset: 'utf-8' };
  const cp1252 = { ...base, declaredMediaType: 'text/html; charset=windows-1252', charset: 'windows-1252' };
  const a = processFetchedDocumentOffline(utf8, source);
  const b = processFetchedDocumentOffline(cp1252, source);
  assert.equal(a.chunkSet.versionId, b.chunkSet.versionId);
  assert.equal(a.chunkSet.profileId, b.chunkSet.profileId);
  assert.notEqual(a.normalized.normalizedText, b.normalized.normalizedText);
  assert.notEqual(a.normalized.normalizedSha256, b.normalized.normalizedSha256);
  assert.equal(a.chunkSet.effectiveCharset, 'utf-8');
  assert.equal(b.chunkSet.effectiveCharset, 'windows-1252');
  assert.equal(a.chunkSet.baseChunkSetId, b.chunkSet.baseChunkSetId);
  assert.equal(a.chunkSet.normalizedSha256, a.normalized.normalizedSha256);
  assert.equal(b.chunkSet.normalizedSha256, b.normalized.normalizedSha256);
  assert.notEqual(a.chunkSet.chunkSetId, b.chunkSet.chunkSetId);
  assert.notEqual(a.chunkSet.chunks[0].id, b.chunkSet.chunks[0].id);
  const recursiveA = makeOfflineChunkSet(a.normalized, utf8, source, RECURSIVE_PROXY_CONFIG);
  const recursiveB = makeOfflineChunkSet(b.normalized, cp1252, source, RECURSIVE_PROXY_CONFIG);
  assert.notEqual(recursiveA.chunkSetId, recursiveB.chunkSetId);
  assert.notEqual(recursiveA.chunks[0].id, recursiveB.chunks[0].id);
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
