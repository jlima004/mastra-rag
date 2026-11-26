import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkId, chunkSetId, documentId, documentVersionId, ingestionIdempotencyKey,
  renderedIngestionIdempotencyKey, sha256,
} from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { validateSourceManifestEntry } from '../contracts/validation.ts';
import { makeOfflineChunkSet, RECURSIVE_PROXY_CONFIG, STRUCTURAL_PROXY_CONFIG } from './chunk.ts';
import { decodeFetchedDocument } from './decode.ts';
import { DOU_EXTRACTOR_CANDIDATE, extractDouHtmlCandidate } from './dou-html.ts';
import { normalizeDouLegalBlocks } from './dou-legal.ts';
import { extractHtmlBlocks } from './html.ts';
import { processFetchedDocumentOffline } from './index.ts';
import { normalizeLegalBlocks } from './legal.ts';
import { H9_TOKEN_GRID_PROFILES, renderH9TokenGridOffline } from './token-grid.ts';

const source = SOURCE_MANIFEST.find(entry => entry.extractor === 'dou-html@1')!;
const candidateSource = { ...source, extractor: DOU_EXTRACTOR_CANDIDATE } as const;
const spaceId = 'chunks_h9c_c2_synthetic';

function fetchedDocument(preamble: string): FetchedDocument {
  const bytes = Buffer.from(
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<article id="materia"><div><div class="texto-dou"><html><head></head><body>' +
    '<p class="identifica">RESOLUÇÃO FICTÍCIA Nº 999, DE 1º DE JANEIRO DE 2099</p>' +
    '<p class="ementa">Ementa para uma prova sintética.</p>' +
    '<p class="dou-paragraph">' + preamble + '</p>' +
    '<p class="dou-paragraph">CAPÍTULO I</p>' +
    '<p class="dou-paragraph">Art. 1º Escopo da prova com 🧪 e café.</p>' +
    '<p class="dou-paragraph">§ 1º Parágrafo sintético.</p>' +
    '<p class="dou-paragraph">I - Inciso sintético.</p>' +
    '<p class="dou-paragraph">a) Alínea sintética.</p>' +
    '</body></html></div></div></article></body></html>',
  );
  return {
    sourceId: source.sourceId,
    documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
    canonicalUri: source.canonicalUri,
    finalUri: source.canonicalUri,
    httpStatus: 200,
    declaredMediaType: 'text/html; charset=utf-8',
    sniffedMediaType: 'text/html',
    charset: 'utf-8',
    byteSize: bytes.byteLength,
    contentSha256: sha256(bytes),
    fetchedAt: '2026-11-26T12:00:00.000Z',
    bytes,
  };
}

const fetched = fetchedDocument('Declaração sintética para esta prova.');

test('DOU candidate identity is offline only and raw document versions bind bytes', () => {
  assert.deepEqual(
    SOURCE_MANIFEST.map(entry => entry.extractor), ['planalto-html@1', 'dou-html@1', 'dou-html@1'],
  );
  assert.throws(() => validateSourceManifestEntry(candidateSource));
  const newBytes = fetchedDocument('Declaração sintética revisada.');
  assert.equal(fetched.documentId, newBytes.documentId);
  assert.notEqual(
    documentVersionId(fetched.documentId, fetched.contentSha256),
    documentVersionId(newBytes.documentId, newBytes.contentSha256),
  );

  const legacy = processFetchedDocumentOffline(fetched, source);
  assert.deepEqual(legacy.normalized, normalizeLegalBlocks(
    extractHtmlBlocks(decodeFetchedDocument(fetched, source)), source,
  ));
});

test('DOU candidate version alone changes profile, chunk and job identities', () => {
  const decoded = decodeFetchedDocument(fetched, source);
  const extracted = extractDouHtmlCandidate(decoded);
  assert.deepEqual(extractDouHtmlCandidate(decoded), extracted);
  const normalized = normalizeDouLegalBlocks(extracted.blocks, source);
  const legacy = processFetchedDocumentOffline(fetched, source);
  assert.equal(normalized.normalizedSha256, legacy.normalized.normalizedSha256);
  assert.equal(normalized.normalizedSha256, sha256(normalized.normalizedText));
  const article = normalized.blocks.find(block => block.kind === 'article')!;
  const alinea = normalized.blocks.find(block => block.kind === 'alinea')!;
  assert.equal(alinea.locator, article.locator + ':par1:inc1:alia');
  assert.equal(article.headingPath[0], 'CAPÍTULO I');
  for (const block of normalized.blocks) {
    assert.equal(normalized.normalizedText.slice(block.start, block.end), block.text);
  }

  for (const config of [STRUCTURAL_PROXY_CONFIG, RECURSIVE_PROXY_CONFIG]) {
    // Render the identical normalized object twice to isolate the extractor stamp.
    const oldSet = makeOfflineChunkSet(normalized, fetched, source, config);
    const newSet = makeOfflineChunkSet(normalized, fetched, candidateSource, config);
    assert.deepEqual(newSet, makeOfflineChunkSet(normalized, fetched, candidateSource, config));
    assert.equal(newSet.versionId, oldSet.versionId);
    assert.equal(newSet.versionId, documentVersionId(fetched.documentId, fetched.contentSha256));
    assert.equal(newSet.headerMetadataSha256, oldSet.headerMetadataSha256);
    assert.notEqual(newSet.profileId, oldSet.profileId);
    assert.equal(newSet.baseChunkSetId, chunkSetId(newSet.versionId, newSet.profileId));
    assert.notEqual(newSet.baseChunkSetId, oldSet.baseChunkSetId);
    assert.notEqual(newSet.chunkSetId, oldSet.chunkSetId);
    assert.notEqual(
      ingestionIdempotencyKey(fetched.documentId, fetched.contentSha256, oldSet.profileId, spaceId),
      ingestionIdempotencyKey(fetched.documentId, fetched.contentSha256, newSet.profileId, spaceId),
    );
    assert.notEqual(
      renderedIngestionIdempotencyKey(fetched.documentId, oldSet.chunkSetId, spaceId),
      renderedIngestionIdempotencyKey(fetched.documentId, newSet.chunkSetId, spaceId),
    );
    assert.ok(newSet.chunks.some(chunk => chunk.legalUnitIds.includes(alinea.locator)));
    for (const chunk of newSet.chunks) {
      assert.equal(chunk.id, chunkId(newSet.chunkSetId, chunk.ordinal));
      assert.notEqual(chunk.id, oldSet.chunks[chunk.ordinal]?.id);
      assert.equal(normalized.normalizedText.slice(chunk.charStart, chunk.charEnd), chunk.body);
      assert.equal(Buffer.from(chunk.body, 'utf8').toString('utf8'), chunk.body);
    }
  }
});

test('each synthetic token-grid profile binds the explicitly selected extractor', () => {
  const extracted = extractDouHtmlCandidate(decodeFetchedDocument(fetched, source));
  const normalized = normalizeDouLegalBlocks(extracted.blocks, source);
  for (const config of H9_TOKEN_GRID_PROFILES) {
    const oldSet = renderH9TokenGridOffline(normalized, fetched, source, config);
    const newSet = renderH9TokenGridOffline(normalized, fetched, candidateSource, config);
    assert.equal(newSet.provenance, 'synthetic-only-unverified-source');
    assert.equal(newSet.paidAdmissionApproved, false);
    assert.equal(newSet.normalizedSha256, oldSet.normalizedSha256);
    assert.notEqual(newSet.profileId, oldSet.profileId);
    assert.notEqual(newSet.chunkSetId, oldSet.chunkSetId);
    assert.equal(newSet.chunks.length, oldSet.chunks.length);
    for (const chunk of newSet.chunks) {
      const { id, ...rendered } = chunk;
      const { id: previousId, ...previousRendered } = oldSet.chunks[chunk.ordinal];
      assert.notEqual(id, previousId);
      assert.equal(id, chunkId(newSet.chunkSetId, chunk.ordinal));
      assert.deepEqual(rendered, previousRendered);
    }
  }
});
