import { sha256 } from '../contracts/ids.ts';
import { RAG_LIMITS, type SourceManifestEntry } from '../contracts/types.ts';
import { isDouHeadingSubtitle, type DouRawLegalBlock } from './dou-html.ts';
import { RagProcessingError } from './errors.ts';
import {
  normalizeLegalBlocks, parseArticleLocator, type LegalBlock, type NormalizedLegalDocument,
} from './legal.ts';

const HEADING_LEVELS = [/^T[IÍ]TULO\s/iu, /^CAP[IÍ]TULO\s/iu, /^SE[CÇ][AÃ]O\s/iu, /^SUBSE[CÇ][AÃ]O\s/iu];
const REVOKED_ARTICLE = /^Art\.\s*\d+(?:-[A-Z])?\s*[ºo.]?\s*\(Revogad[oa]\)[.;]?$/i;
const REVOKED_BLOCK = /^\(?Revogad[oa]\)?[.;]?$/i;

function annexLocator(locator: string): string {
  return locator.replace(':', ':anexo1:');
}

function verifyRevokedTransitions(raw: readonly DouRawLegalBlock[]): void {
  let revokedArticle = false;
  for (const block of raw) {
    const text = block.text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (REVOKED_ARTICLE.test(text)) revokedArticle = true;
    else if (REVOKED_BLOCK.test(text) || !text) continue;
    else if (block.kind === 'heading' || parseArticleLocator(text, 'dou')) revokedArticle = false;
    else if (revokedArticle) throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
  }
}

/**
 * DOU annexes can reuse main-act article numbers. Normalize each legal scope
 * independently and preserve the resulting text, with offsets into the
 * complete document and a distinct locator prefix for annex units.
 */
export function normalizeDouLegalBlocks(
  raw: readonly DouRawLegalBlock[],
  source: SourceManifestEntry,
): NormalizedLegalDocument {
  const annex = raw.findIndex(block => block.role === 'annex');
  const signature = raw.findIndex(block => block.role === 'signature');
  const office = raw.findIndex(block => block.role === 'office');
  const actEnd = annex < 0 ? raw.length : annex;
  if (annex === 0 || raw.slice(actEnd + 1).some(block => block.role === 'annex') ||
      ((signature >= 0 || office >= 0) &&
        (signature < 1 || office !== signature + 1 || office !== actEnd - 1 ||
          raw.some((block, index) =>
            (block.role === 'signature' && index !== signature) ||
            (block.role === 'office' && index !== office))))) {
    throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
  }

  const pieces: string[] = [];
  const blocks: LegalBlock[] = [];
  let offset = 0;
  function appendScope(scope: readonly DouRawLegalBlock[], inAnnex = false): void {
    verifyRevokedTransitions(scope);
    const normalized = normalizeLegalBlocks(scope, source);
    if (pieces.length) offset += 2;
    if (offset + normalized.normalizedText.length > RAG_LIMITS.MAX_NORMALIZED_CHARS) {
      throw new RagProcessingError('NORMALIZED_TOO_LARGE');
    }
    const first = normalized.blocks[0];
    if (inAnnex && first.kind !== 'heading') throw new RagProcessingError('EXTRACT_UNSUPPORTED_HTML');
    const annexPath = inAnnex ? [first.text] : [];
    const hierarchy: string[] = [];
    for (const [index, block] of normalized.blocks.entries()) {
      if (block.kind === 'heading') {
        const level = HEADING_LEVELS.findIndex(pattern => pattern.test(block.text));
        if (level >= 0) {
          const subtitle = normalized.blocks[index + 1];
          const hasSubtitle = subtitle?.kind === 'heading' &&
            isDouHeadingSubtitle(block.text, subtitle.text);
          hierarchy.length = level;
          hierarchy[level] = hasSubtitle ? block.text + ' — ' + subtitle.text : block.text;
        }
      }
      blocks.push(Object.freeze({
        ...block,
        start: offset + block.start,
        end: offset + block.end,
        locator: inAnnex ? annexLocator(block.locator) : block.locator,
        articleLocator: inAnnex && block.articleLocator ? annexLocator(block.articleLocator) : block.articleLocator,
        headingPath: Object.freeze([...annexPath, ...hierarchy.filter(Boolean)]),
      }));
    }
    pieces.push(normalized.normalizedText);
    offset += normalized.normalizedText.length;
  }

  appendScope(raw.slice(0, signature < 0 ? actEnd : signature));
  if (signature >= 0) appendScope(raw.slice(signature, actEnd));
  if (annex >= 0) appendScope(raw.slice(annex), true);
  const normalizedText = pieces.join('\n\n');
  return Object.freeze({
    sourceId: source.sourceId,
    normalizedText,
    normalizedSha256: sha256(normalizedText),
    blocks: Object.freeze(blocks),
  });
}
