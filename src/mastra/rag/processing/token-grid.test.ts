import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { documentId, pipelineProfileId, sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { normalizeLegalBlocks } from './legal.ts';
import { RagProcessingError } from './errors.ts';
import { processFetchedDocumentOffline } from './index.ts';
import { countH9Cl100kTokens } from './cl100k-counter.ts';
import { H9_TOKEN_GRID_PROFILES, renderH9TokenGridOffline } from './token-grid.ts';

const source = SOURCE_MANIFEST[0];
const bytes = readFileSync(new URL('./fixtures/synthetic-lgpd.html', import.meta.url));
const fetched: FetchedDocument = {
  sourceId: source.sourceId,
  documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
  canonicalUri: source.canonicalUri, finalUri: source.canonicalUri,
  httpStatus: 200, declaredMediaType: 'text/html; charset=utf-8',
  sniffedMediaType: 'text/html', charset: 'utf-8',
  byteSize: bytes.length, contentSha256: sha256(bytes),
  fetchedAt: '2026-11-23T00:00:00.000Z', bytes,
};
const original = processFetchedDocumentOffline(fetched, source);
const doc = original.normalized;

test('H9C four offline profiles are distinct from legacy byte-proxy identities', () => {
  assert.equal(H9_TOKEN_GRID_PROFILES.length, 4);
  assert.equal(original.chunkSet.tokenizer, 'utf8-byte-proxy@1');
  const sets = H9_TOKEN_GRID_PROFILES.map(p => renderH9TokenGridOffline(doc, fetched, source, p));
  assert.equal(new Set(sets.map(s => s.profileId)).size, 4);
  assert.equal(new Set(sets.map(s => s.chunkSetId)).size, 4);
  assert.ok(sets.every(s => s.chunkSetId !== original.chunkSet.chunkSetId));
  assert.equal(sets[0].tokenizer, 'cl100k_base/js-tiktoken@1.0.21');
  assert.ok(sets.every(s => s.provenance === 'synthetic-only-unverified-source'));
  assert.ok(sets.every(s => s.paidAdmissionApproved === false));
  assert.ok(sets.every(s => Object.isFrozen(s) && Object.isFrozen(s.chunks)));
});

test('H9C counts complete input, preserves UTF-16 source offsets and legal locators', () => {
  for (const config of H9_TOKEN_GRID_PROFILES) {
    const result = renderH9TokenGridOffline(doc, fetched, source, config);
    const again = renderH9TokenGridOffline(doc, fetched, source, config);
    assert.deepEqual(result, again);
    assert.ok(result.chunks.length > 0);
    assert.equal(result.totalTokens,
      result.chunks.reduce((n, c) => n + c.tokenCount, 0));
    assert.equal(new Set(result.chunks.map(c => c.id)).size, result.chunks.length);
    for (const chunk of result.chunks) {
      assert.equal(doc.normalizedText.slice(chunk.charStart, chunk.charEnd), chunk.body);
      assert.equal(countH9Cl100kTokens(chunk.content), chunk.tokenCount);
      assert.ok(chunk.tokenCount <= config.maxTokens);
      assert.ok(chunk.tokenCount >= 1);
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(chunk.body));
      assert.ok(chunk.id !== original.chunkSet.chunks[0].id);
      assert.equal(chunk.ordinal, result.chunks.indexOf(chunk));
      if (doc.blocks.some(b => b.kind !== 'heading' && b.start < chunk.charEnd && b.end > chunk.charStart))
        assert.ok(chunk.legalUnitIds.length > 0);
    }
  }
});

test('H9C structural grid covers every normative source character, excluding headings', () => {
  for (const config of H9_TOKEN_GRID_PROFILES.filter(p => p.strategy === 'legal-structure')) {
    const result = renderH9TokenGridOffline(doc, fetched, source, config);
    for (const block of doc.blocks.filter(b => b.kind !== 'heading')) {
      for (let offset = block.start; offset < block.end; offset++) {
        assert.ok(result.chunks.some(c => c.charStart <= offset && c.charEnd > offset),
          'non-heading code unit lost at offset ' + offset);
      }
    }
  }
});

test('H9C recursive comparator produces measurable overlap with forward progress', () => {
  const config = H9_TOKEN_GRID_PROFILES[3];
  const longDoc = normalizeLegalBlocks([
    { kind: 'heading', text: 'CAPÍTULO ÚNICO' },
    { kind: 'text', text: 'Art. 1º Este conteúdo é apenas uma simulação. ' + 'Proteção de dados pessoais e transparência. '.repeat(110) },
  ], source);
  const result = renderH9TokenGridOffline(longDoc, fetched, source, config);
  assert.ok(result.chunks.length >= 2);
  let hasOverlap = false;
  for (let i = 1; i < result.chunks.length; i++) {
    const prev = result.chunks[i - 1], cur = result.chunks[i];
    assert.ok(cur.charStart > prev.charStart, 'must advance');
    assert.ok(cur.charStart <= prev.charEnd, 'gap detected');
    if (cur.charStart < prev.charEnd) {
      hasOverlap = true;
      const repeated = longDoc.normalizedText.slice(cur.charStart, prev.charEnd);
      assert.ok(countH9Cl100kTokens(repeated) <= config.overlapTokens);
    }
  }
  assert.ok(hasOverlap);
});

test('H9C splits oversized synthetic legal child without breaking Unicode scalars', () => {
  const large = normalizeLegalBlocks([
    { kind: 'heading', text: 'CAPÍTULO ÚNICO' },
    { kind: 'text', text: 'Art. 1º Texto jurídico inventado para o teste.' },
    { kind: 'text', text: 'I - ' + ('Ação 🧪 e proteção de dados; '.repeat(400)) },
  ], source);
  const config = H9_TOKEN_GRID_PROFILES[0];
  const set = renderH9TokenGridOffline(large, fetched, source, config);
  assert.ok(set.chunks.length > 3);
  const bigBlock = large.blocks[2];
  assert.ok(set.chunks.some(c => c.charStart > bigBlock.start));
  for (const chunk of set.chunks) {
    assert.equal(large.normalizedText.slice(chunk.charStart, chunk.charEnd), chunk.body);
    assert.ok(chunk.tokenCount <= config.maxTokens);
    assert.ok(!chunk.body.includes('\uFFFD'));
  }
});

test('H9C rejects tampered source hashes and out-of-contract grid profiles', () => {
  assert.throws(() => renderH9TokenGridOffline(
    { ...doc, normalizedSha256: 'a'.repeat(64) }, fetched, source, H9_TOKEN_GRID_PROFILES[0],
  ), e => e instanceof RagProcessingError && e.code === 'INVALID_DOCUMENT');
  assert.throws(() => renderH9TokenGridOffline(
    doc, fetched, source,
    { strategy: 'legal-structure', maxTokens: 400, overlapTokens: 60 },
  ), e => e instanceof RagProcessingError && e.code === 'INVALID_DOCUMENT');
});


const H9C_R2_LEGAL_CAP = 256;
const H9C_R2_CHAPTER = 'CAPÍTULO TESTE';
const H9C_R2_CRUMB = [source.title, H9C_R2_CHAPTER, 'lgpd:art1'].join(' › ');

/**
 * Find a *real cl100k_base* boundary instead of assuming that a fixed
 * number of characters is equivalent to 256 model tokens. These are all
 * invented legal texts, never sampled official legislation.
 */
function h9cR2NearLimitCaput(condition: (header: string) => boolean): string {
  for (let count = 1; count < 600; count++) {
    const caput = ('Art. 1º ' + 'dado '.repeat(count)).trim();
    const header = H9C_R2_CRUMB + '\n' + caput;
    if (condition(header)) return caput;
  }
  assert.fail('Unable to reproduce cl100k_base Unicode boundary on synthetic input');
}
function h9cR2FullInput(header: string, body: string): string {
  return header + '\n---\n' + body;
}
function h9cR2Doc(caput: string, child: string) {
  return normalizeLegalBlocks([
    { kind: 'heading', text: H9C_R2_CHAPTER },
    { kind: 'text', text: caput },
    { kind: 'text', text: child },
  ], source);
}
function h9cR2AssertOffsetIntegrity(
  document: ReturnType<typeof normalizeLegalBlocks>,
  chunks: ReturnType<typeof renderH9TokenGridOffline>['chunks'],
): void {
  for (const chunk of chunks) {
    assert.equal(document.normalizedText.slice(chunk.charStart, chunk.charEnd), chunk.body);
    assert.ok(chunk.tokenCount <= H9C_R2_LEGAL_CAP);
    assert.equal(countH9Cl100kTokens(chunk.content), chunk.tokenCount);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(chunk.body));
  }
  for (const block of document.blocks.filter(block => block.kind !== 'heading')) {
    for (let offset = block.start; offset < block.end; offset++) {
      assert.ok(chunks.some(chunk => chunk.charStart <= offset && chunk.charEnd > offset),
        'source character uncovered at UTF-16 offset ' + offset);
    }
  }
}

test('H9C R2 uses actual leading emoji to downgrade header before splitting', () => {
  const caput = h9cR2NearLimitCaput(header =>
    countH9Cl100kTokens(h9cR2FullInput(header, 'x')) <= H9C_R2_LEGAL_CAP &&
    countH9Cl100kTokens(h9cR2FullInput(header, '🧪')) > H9C_R2_LEGAL_CAP);
  const document = h9cR2Doc(caput, '🧪 Proteção de dados em cenário inventado.');
  const child = document.blocks[2];
  const result = renderH9TokenGridOffline(document, fetched, source, H9_TOKEN_GRID_PROFILES[0]);
  const firstChild = result.chunks.find(chunk => chunk.charStart === child.start);
  assert.ok(firstChild, 'the leading Unicode scalar must be covered');
  assert.ok(firstChild.body.startsWith('🧪'));
  assert.ok(firstChild.content.startsWith(H9C_R2_CRUMB + '\n---\n'),
    'the shorter breadcrumb must be selected instead of an overlong caput');
  assert.ok(!firstChild.content.startsWith(H9C_R2_CRUMB + '\n' + caput));
  assert.ok(firstChild.legalUnitIds.some(id => id.includes('art1')));
  h9cR2AssertOffsetIntegrity(document, result.chunks);
  assert.equal(result.paidAdmissionApproved, false);
});

test('H9C R2 downgrades the header when a later window starts with a multi-token emoji', () => {
  const caput = h9cR2NearLimitCaput(header =>
    countH9Cl100kTokens(h9cR2FullInput(header, 'x')) <= H9C_R2_LEGAL_CAP &&
    countH9Cl100kTokens(h9cR2FullInput(header, 'x🧪')) > H9C_R2_LEGAL_CAP &&
    countH9Cl100kTokens(h9cR2FullInput(header, '🧪')) > H9C_R2_LEGAL_CAP);
  const document = h9cR2Doc(caput, 'x🧪 Texto de demonstração.');
  const child = document.blocks[2];
  const result = renderH9TokenGridOffline(document, fetched, source, H9_TOKEN_GRID_PROFILES[0]);
  const firstChild = result.chunks.find(chunk => chunk.charStart === child.start);
  assert.ok(firstChild);
  assert.equal(firstChild.body, 'x', 'the long header must fit only the first scalar');
  assert.ok(firstChild.content.startsWith(H9C_R2_CRUMB + '\n' + caput + '\n---\n'));
  const nextChild = result.chunks.find(chunk => chunk.charStart === firstChild.charEnd);
  assert.ok(nextChild, 'segment following the first scalar must exist');
  assert.ok(nextChild.body.startsWith('🧪'));
  assert.ok(nextChild.content.startsWith(H9C_R2_CRUMB + '\n---\n'),
    'a later Unicode scalar must trigger per-window header downgrade');
  assert.equal(nextChild.charStart, child.start + 1);
  assert.equal(nextChild.legalUnitIds.includes(child.locator), true);
  h9cR2AssertOffsetIntegrity(document, result.chunks);
  assert.equal(result.paidAdmissionApproved, false);
});

test('H9C R2 structural algorithm @2 has new profile IDs and leaves recursive identity unchanged', () => {
  const profile = H9_TOKEN_GRID_PROFILES[0];
  const oldProfile = pipelineProfileId({
    chunker: {
      strategy: profile.strategy,
      maxTokens: profile.maxTokens,
      overlapTokens: profile.overlapTokens,
      tokenizer: 'cl100k_base/js-tiktoken@1.0.21',
      contextHeader: 'breadcrumb+caput',
      algorithmVersion: 'legal-structure-token-greedy@1',
    },
    extractor: source.extractor,
    normalizer: 'legal-text@1',
  });
  const newStructural = renderH9TokenGridOffline(doc, fetched, source, profile);
  assert.notEqual(newStructural.profileId, oldProfile);
  assert.notEqual(newStructural.chunkSetId, original.chunkSet.chunkSetId);
  assert.ok(newStructural.chunks.every(chunk => chunk.id !== original.chunkSet.chunks[0].id));
  const recursive = H9_TOKEN_GRID_PROFILES[3];
  const previousRecursiveId = pipelineProfileId({
    chunker: {
      strategy: recursive.strategy, maxTokens: recursive.maxTokens,
      overlapTokens: recursive.overlapTokens,
      tokenizer: 'cl100k_base/js-tiktoken@1.0.21',
      contextHeader: 'none',
      algorithmVersion: 'recursive-token-window@1',
    },
    extractor: source.extractor,
    normalizer: 'legal-text@1',
  });
  assert.equal(renderH9TokenGridOffline(doc, fetched, source, recursive).profileId,
    previousRecursiveId);
});
