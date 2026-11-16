import { sha256 } from '../contracts/ids.ts';
import { RAG_LIMITS, type SourceManifestEntry } from '../contracts/types.ts';
import { RagProcessingError } from './errors.ts';
import type { RawLegalBlock } from './html.ts';

export type LegalBlockKind =
  'heading' | 'article' | 'paragraph' | 'inciso' | 'alinea' | 'preamble';

export type LegalBlock = Readonly<{
  kind: LegalBlockKind;
  text: string;
  start: number;
  end: number;
  locator: string;
  articleLocator: string | null;
  headingPath: readonly string[];
  annotations: readonly string[];
}>;

export type NormalizedLegalDocument = Readonly<{
  sourceId: string;
  normalizedText: string;
  normalizedSha256: string;
  blocks: readonly LegalBlock[];
}>;

function romanToDecimal(roman: string): number | null {
  const digits: Record<string, number> = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  const upper = roman.toUpperCase();
  let value = 0;
  for (let i = 0; i < upper.length; i++) {
    const n = digits[upper[i]];
    if (!n) return null;
    value += i + 1 < upper.length && n < digits[upper[i+1]] ? -n : n;
  }
  // Reject malformed roman numerals and zero by round-trip validation.
  if (value < 1 || value > 3999) return null;
  let rest = value;
  let rebuilt = '';
  for (const [n, r] of [
    [1000,'M'], [900,'CM'], [500,'D'], [400,'CD'], [100,'C'],
    [90,'XC'], [50,'L'], [40,'XL'], [10,'X'], [9,'IX'],
    [5,'V'], [4,'IV'], [1,'I'],
  ] as const) {
    while (rest >= n) { rebuilt += r; rest -= n; }
  }
  return upper === rebuilt ? value : null;
}

export function parseArticleLocator(text: string, prefix: string): string | null {
  const match = /^Art\.\s*(\d{1,4})(?:\s*[-–]\s*([A-Z]))?(?:[.º°o])?(?=\s|[.,:;]|$)/iu.exec(text);
  if (!match) return null;
  return prefix + ':art' + String(Number(match[1])) +
    (match[2] ? '-' + match[2].toLowerCase() : '');
}

function getPrefix(source: SourceManifestEntry): string {
  if (source.sourceId === 'br-planalto-lei-13709-2018') return 'lgpd';
  return source.sourceId.replace(/^br-/, '').replace(/[^a-z0-9]+/g, '-');
}

function isHeading(text: string): boolean {
  return /^(?:T[IÍ]TULO|CAP[IÍ]TULO|SE[CÇ][AÃ]O|SUBSE[CÇ][AÃ]O)\b/i.test(text);
}

/** Normalizes only whitespace and Unicode, never silently rewrites legal meaning. */
function normalizeBlockText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function amendments(text: string): readonly string[] {
  const found = text.match(/\((?:Reda[cç][aã]o dada|Inclu[ií]d[oa]|Acrescentad[oa]|Revogad[oa])[^)]{0,240}\)/giu);
  return Object.freeze(found ?? []);
}

/**
 * Stores offsets in UTF-16 units, exactly the indexing used by String.slice.
 * No parser or chunker may put a synthetic context header into this text.
 */
export function normalizeLegalBlocks(
  raw: readonly RawLegalBlock[],
  source: SourceManifestEntry,
): NormalizedLegalDocument {
  if (!Array.isArray(raw) || !raw.length) throw new RagProcessingError('EXTRACT_EMPTY');
  const prefix = getPrefix(source);
  const pieces: string[] = [];
  const blocks: LegalBlock[] = [];
  let currentArticle: string | null = null;
  let currentInciso: string | null = null;
  let currentParagraph: string | null = null;
  let chapter = '';
  let section = '';
  let charOffset = 0;

  for (const entry of raw) {
    if (!entry || typeof entry.text !== 'string' ||
        !['heading','text'].includes(entry.kind)) {
      throw new RagProcessingError('INVALID_DOCUMENT');
    }
    const text = normalizeBlockText(entry.text);
    if (!text) continue;
    if (/^\(?Revogad[oa]\)?[.;]?$/i.test(text) ||
        /^Art\.\s*\d+(?:-[A-Z])?\s*[ºo.]?\s*\(Revogad[oa]\)[.;]?$/i.test(text)) continue;
    let kind: LegalBlockKind = 'preamble';
    let locator = prefix + ':preambulo';
    const article = parseArticleLocator(text, prefix);
    if (entry.kind === 'heading' || isHeading(text)) {
      kind = 'heading';
      if (/^CAP[IÍ]TULO\b/i.test(text)) {
        chapter = text;
        section = '';
      } else if (/^(?:SE[CÇ][AÃ]O|SUBSE[CÇ][AÃ]O)\b/i.test(text)) {
        section = text;
      }
      currentArticle = null;
      currentInciso = null;
      currentParagraph = null;
      locator = prefix + ':heading';
    } else if (article) {
      currentArticle = article;
      currentParagraph = null;
      currentInciso = null;
      kind = 'article';
      locator = article;
    } else if (currentArticle) {
      const paragraph = /^§\s*(\d+)\s*[º°o]?(?=\s|[.,:;]|$)/iu.exec(text);
      if (/^Par[aá]grafo\s+[uú]nico\b/iu.test(text)) {
        currentParagraph = currentArticle + ':parunico';
        currentInciso = null;
        kind = 'paragraph';
        locator = currentParagraph;
      } else if (paragraph) {
        currentParagraph = currentArticle + ':par' + String(Number(paragraph[1]));
        currentInciso = null;
        kind = 'paragraph';
        locator = currentParagraph;
      } else {
        const inciso = /^([IVXLCDM]+)\s*[-–—]\s+/iu.exec(text);
        const number = inciso && romanToDecimal(inciso[1]);
        if (number !== null && number !== undefined) {
          currentInciso = (currentParagraph ?? currentArticle) + ':inc' + number;
          kind = 'inciso';
          locator = currentInciso;
        } else {
          const alinea = /^([a-z])\)\s+/iu.exec(text);
          if (alinea) {
            kind = 'alinea';
            locator = (currentInciso ?? currentParagraph ?? currentArticle) + ':ali' + alinea[1].toLowerCase();
          } else {
            kind = 'paragraph';
            locator = currentParagraph ?? currentInciso ?? currentArticle;
          }
        }
      }
    }
    if (pieces.length) charOffset += 2;
    const start = charOffset;
    charOffset += text.length;
    if (charOffset > RAG_LIMITS.MAX_NORMALIZED_CHARS) {
      throw new RagProcessingError('NORMALIZED_TOO_LARGE');
    }
    const path = [chapter, section].filter(Boolean);
    const block: LegalBlock = Object.freeze({
      kind, text, start, end: charOffset, locator,
      articleLocator: kind === 'heading' ? null : currentArticle,
      headingPath: Object.freeze(path),
      annotations: amendments(text),
    });
    blocks.push(block);
    pieces.push(text);
  }

  if (!blocks.length) throw new RagProcessingError('EXTRACT_EMPTY');
  const normalizedText = pieces.join('\n\n');
  return Object.freeze({
    sourceId: source.sourceId,
    normalizedText,
    normalizedSha256: sha256(normalizedText),
    blocks: Object.freeze(blocks),
  });
}
