import assert from 'node:assert/strict';
import test from 'node:test';
import { documentId, renderedIngestionIdempotencyKey, sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { countH9Cl100kTokens } from './cl100k-counter.ts';
import { DOU_EXTRACTOR_CANDIDATE } from './dou-html.ts';
import { normalizeDouLegalBlocks } from './dou-legal.ts';
import { aggregateMvpGrid, measureMvpGrid } from './mvp-grid-metrics.ts';
import { H9_TOKEN_GRID_PROFILES, renderH9TokenChunksOffline } from './token-grid.ts';

function fixture(source: typeof SOURCE_MANIFEST[number], length: number) {
  const doc = normalizeDouLegalBlocks([
    { kind: 'heading', text: 'Cabeçalho de um ato inventado' },
    { kind: 'text', text: 'Art. 1º Regras de um arquivo imaginário.' },
    { kind: 'text', text: '§ 1º A equipe registra cada teste.' },
    { kind: 'text', text: 'I - Ação fictícia 🧪 a ser descrita. '.repeat(length) },
    { kind: 'heading', role: 'annex', text: 'ANEXO' },
    { kind: 'heading', text: 'CAPÍTULO I' },
    { kind: 'heading', text: 'DA VERIFICAÇÃO DE TESTE' },
    { kind: 'text', text: 'Art. 1º Exemplo de procedimento em laboratório fictício.' },
  ], source);
  const bytes = Buffer.from('Invented fixture ' + source.sourceId + ' ' + length);
  const fetched: FetchedDocument = {
    sourceId: source.sourceId,
    documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
    canonicalUri: source.canonicalUri, finalUri: source.canonicalUri,
    httpStatus: 200, declaredMediaType: 'text/html; charset=utf-8',
    sniffedMediaType: 'text/html', charset: 'utf-8', byteSize: bytes.length,
    contentSha256: sha256(bytes), fetchedAt: '2026-11-26T00:00:00.000Z', bytes,
  };
  return { doc, fetched, source: { ...source, extractor: DOU_EXTRACTOR_CANDIDATE } as const };
}

const first = fixture(SOURCE_MANIFEST[1], 175);
const second = fixture(SOURCE_MANIFEST[2], 12);

test('MVP grid measures exact rendered inputs, tolerant heading omission, and bounded overlap', () => {
  for (const config of H9_TOKEN_GRID_PROFILES) {
    const { doc, fetched, source } = first;
    const set = renderH9TokenChunksOffline(doc, fetched, source, config);
    const { metrics, tokenCounts } = measureMvpGrid(doc, fetched, source, set);
    const again = measureMvpGrid(doc, fetched, source, renderH9TokenChunksOffline(doc, fetched, source, config));
    assert.deepEqual(metrics, again.metrics);
    assert.deepEqual(tokenCounts, set.chunks.map(chunk => countH9Cl100kTokens(chunk.content)));
    assert.ok(metrics.verified);
    assert.equal(metrics.coverage.articles.fullyCovered, 2);
    assert.equal(metrics.coverage.incisos.fullyCovered, 1);
    assert.equal(metrics.coverage.paragraphs.fullyCovered, 1);
    assert.equal(metrics.coverage.annexes.fullyCovered, 1);
    assert.equal(metrics.structure.explicitLocatorsExpected, 4);
    assert.equal(metrics.structure.explicitLocatorsPreserved, 4);
    assert.equal(metrics.offsets.unexpectedGapUtf16, 0);
    assert.equal(metrics.offsets.unexpectedDuplicateUtf16, 0);
    assert.equal(metrics.identity.v2IdempotencyKey,
      renderedIngestionIdempotencyKey(fetched.documentId, set.chunkSetId, 'chunks_te3s_1536_v1'));
    assert.equal(metrics.identity.chunkIds.length, set.chunks.length);
    assert.ok(!JSON.stringify(metrics).includes(doc.blocks[2].text));
    if (config.strategy === 'recursive-baseline') {
      assert.ok(metrics.chunking.intentionalOverlapTokens > 0);
      assert.equal(metrics.chunking.headerAndSeparatorTokens, 0);
      assert.equal(metrics.offsets.coveredUtf16, doc.normalizedText.length);
      assert.equal(metrics.coverage.headings.fullyCovered, 4);
    } else {
      assert.ok(metrics.chunking.headerAndSeparatorTokens > 0);
      assert.equal(metrics.chunking.intentionalOverlapTokens, 0);
      assert.equal(metrics.coverage.headings.fullyCovered, 0);
      assert.ok(metrics.structure.headingsRepresentedByBreadcrumb >= 2);
      assert.ok(metrics.offsets.expectedOmittedHeadingUtf16 > 0);
      assert.equal(metrics.structure.chunksWithMultipleArticles, 0);
    }
  }
});

test('MVP corpus percentiles use every chunk and scope coverage is source-local', () => {
  for (const config of H9_TOKEN_GRID_PROFILES) {
    const results = [first, second].map(({ doc, fetched, source }) =>
      measureMvpGrid(doc, fetched, source, renderH9TokenChunksOffline(doc, fetched, source, config)));
    const aggregate = aggregateMvpGrid(results);
    const counts = results.flatMap(result => result.tokenCounts).sort((a, b) => a - b);
    assert.equal(aggregate.chunking.count, counts.length);
    assert.equal(aggregate.chunking.p50, counts[Math.ceil(counts.length * 0.5) - 1]);
    assert.equal(aggregate.chunking.p95, counts[Math.ceil(counts.length * 0.95) - 1]);
    assert.equal(aggregate.coverage.annexes.fullyCovered, 2);
    assert.ok(aggregate.verified);
  }
});

test('MVP grid distinguishes malformed offsets, hidden gaps, unplanned duplicates and locator loss', () => {
  const { doc, fetched, source } = first;
  const set = renderH9TokenChunksOffline(doc, fetched, source, H9_TOKEN_GRID_PROFILES[0]);
  const [firstChunk, secondChunk, ...rest] = set.chunks;
  const invalidOffsets = measureMvpGrid(doc, fetched, source, {
    ...set, chunks: [{ ...firstChunk, charStart: -1 }, secondChunk, ...rest],
  }).metrics;
  assert.equal(invalidOffsets.offsets.offsetMismatches, 1);
  assert.ok(invalidOffsets.offsets.unexpectedGapUtf16 > 0);
  assert.equal(invalidOffsets.verified, false);

  const duplicate = measureMvpGrid(doc, fetched, source, {
    ...set, chunks: [firstChunk, firstChunk, secondChunk, ...rest],
  }).metrics;
  assert.ok(duplicate.offsets.unexpectedDuplicateUtf16 > 0);
  assert.equal(duplicate.identity.verified, false);
  assert.equal(duplicate.verified, false);

  const missingLocator = measureMvpGrid(doc, fetched, source, {
    ...set, chunks: [{ ...firstChunk, legalUnitIds: [] }, secondChunk, ...rest],
  }).metrics;
  assert.ok(missingLocator.structure.explicitLocatorsPreserved < missingLocator.structure.explicitLocatorsExpected);
  assert.equal(missingLocator.structure.locatorMetadataMismatches, 1);
  assert.equal(missingLocator.verified, false);
});
