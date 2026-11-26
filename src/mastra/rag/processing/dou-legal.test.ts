import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { DouRawLegalBlock } from './dou-html.ts';
import { normalizeDouLegalBlocks } from './dou-legal.ts';
import { RagProcessingError } from './errors.ts';
import { normalizeLegalBlocks } from './legal.ts';

const source = SOURCE_MANIFEST.find(entry => entry.extractor === 'dou-html@1')!;
const raw = [
  { kind: 'text', text: 'Ementa sintética.' },
  { kind: 'heading', text: 'CAPÍTULO I' },
  { kind: 'text', text: 'Art. 1º Ato sintético 🧪.' },
  { kind: 'text', text: 'Nome fictício', role: 'signature' },
  { kind: 'text', text: 'Cargo fictício', role: 'office' },
  { kind: 'heading', text: 'ANEXO TESTE', role: 'annex' },
  { kind: 'text', text: 'Art. 1º Primeiro artigo do anexo.' },
  { kind: 'text', text: '§ 1º Parágrafo do anexo.' },
  { kind: 'text', text: 'I – Inciso de teste.' },
] as const satisfies readonly DouRawLegalBlock[];

test('DOU annex and signatures preserve text and offsets with independent legal context', () => {
  const legacy = normalizeLegalBlocks(raw, source);
  const candidate = normalizeDouLegalBlocks(raw, source);
  assert.equal(candidate.normalizedText, legacy.normalizedText);
  assert.equal(candidate.normalizedSha256, legacy.normalizedSha256);
  assert.deepEqual(candidate, normalizeDouLegalBlocks(raw, source));
  assert.equal(legacy.blocks[2].locator, legacy.blocks[6].locator);
  assert.equal(candidate.blocks[2].locator, legacy.blocks[2].locator);
  assert.equal(candidate.blocks[3].articleLocator, null);
  assert.equal(candidate.blocks[4].articleLocator, null);
  assert.deepEqual(candidate.blocks[6].headingPath, ['ANEXO TESTE']);
  assert.equal(candidate.blocks[6].locator, candidate.blocks[2].locator.replace(':', ':anexo1:'));
  assert.equal(candidate.blocks[8].locator, candidate.blocks[6].locator + ':par1:inc1');
  for (const block of candidate.blocks) {
    assert.equal(candidate.normalizedText.slice(block.start, block.end), block.text);
  }
});

test('DOU normalization rejects multiple annexes or detached signature roles', () => {
  for (const blocks of [[...raw, raw[5]], raw.filter(block => !('role' in block) || block.role !== 'office')]) {
    assert.throws(() => normalizeDouLegalBlocks(blocks, source), (error: unknown) =>
      error instanceof RagProcessingError && error.code === 'EXTRACT_UNSUPPORTED_HTML');
  }
});

test('DOU chapter and section subtitle blocks also appear in descendant context', () => {
  const document = normalizeDouLegalBlocks([
    { kind: 'heading', text: 'CAPÍTULO I' },
    { kind: 'heading', text: 'Disposições de teste', role: 'heading-subtitle' },
    { kind: 'heading', text: 'Seção I' },
    { kind: 'heading', text: 'Da estrutura fictícia', role: 'heading-subtitle' },
    { kind: 'text', text: 'Art. 1º Disposição sintética.' },
  ], source);
  assert.deepEqual(document.blocks.at(-1)?.headingPath, [
    'CAPÍTULO I — Disposições de teste', 'Seção I — Da estrutura fictícia',
  ]);
  assert.equal(document.blocks.length, 5);
});

test('DOU rejects an unscoped child after a revoked article placeholder', () => {
  const ambiguous = [
    { kind: 'text', text: 'Art. 1º Caput vigente de teste.' },
    { kind: 'text', text: 'Art. 2º (Revogado)' },
    { kind: 'text', text: 'I – Unidade ligada ao marcador revogado.' },
  ] as const;
  assert.throws(() => normalizeDouLegalBlocks(ambiguous, source), (error: unknown) =>
    error instanceof RagProcessingError && error.code === 'EXTRACT_UNSUPPORTED_HTML');
  const withNewArticle = normalizeDouLegalBlocks([
    ...ambiguous.slice(0, 2),
    { kind: 'text', text: 'Art. 3º Caput vigente de teste.' },
    ambiguous[2],
  ], source);
  assert.match(withNewArticle.blocks[2].locator, /:art3:inc1$/);
});
