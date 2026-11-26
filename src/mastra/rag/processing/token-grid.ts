import {
  canonicalJson, chunkId, chunkSetId, documentVersionId, pipelineProfileId, sha256,
} from '../contracts/ids.ts';
import { RAG_LIMITS, type FetchedDocument } from '../contracts/types.ts';
import { RagProcessingError } from './errors.ts';
import type { LegalBlock, NormalizedLegalDocument } from './legal.ts';
import { renderAwareChunkSetId, type OfflineChunkSource } from './chunk.ts';
import { countH9Cl100kTokens } from './cl100k-counter.ts';
import { H9_MAX_AUDIT_INPUT_CHARS } from './token-calibration.ts';

export type H9TokenChunkStrategy = 'legal-structure' | 'recursive-baseline';
export type H9TokenGridConfig = Readonly<{
  strategy: H9TokenChunkStrategy;
  maxTokens: 256 | 400 | 512 | 1024;
  overlapTokens: number;
}>;

export const H9_TOKEN_GRID_PROFILES: readonly H9TokenGridConfig[] = Object.freeze([
  Object.freeze({ strategy: 'legal-structure', maxTokens: 256, overlapTokens: 0 }),
  Object.freeze({ strategy: 'legal-structure', maxTokens: 512, overlapTokens: 0 }),
  Object.freeze({ strategy: 'legal-structure', maxTokens: 1024, overlapTokens: 0 }),
  Object.freeze({ strategy: 'recursive-baseline', maxTokens: 400, overlapTokens: 60 }),
]);

export type H9RenderedTokenChunk = Readonly<{
  id: string;
  ordinal: number;
  content: string;
  body: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  articleLocator: string | null;
  legalUnitIds: readonly string[];
}>;

export type H9RenderedTokenSet = Readonly<{
  provenance: 'synthetic-only-unverified-source';
  paidAdmissionApproved: false;
  profileId: string;
  chunkSetId: string;
  normalizedSha256: string;
  tokenizer: 'cl100k_base/js-tiktoken@1.0.21';
  identityVersion: 'rag:chunkset-rendered:v2';
  config: H9TokenGridConfig;
  totalTokens: number;
  chunks: readonly H9RenderedTokenChunk[];
}>;

const SEPARATOR = '\n---\n';
function fail(code: 'INVALID_DOCUMENT' | 'CHUNK_EMPTY' | 'CHUNK_HEADER_TOO_LARGE' |
  'CHUNK_TOO_LARGE' | 'CHUNK_BUDGET_EXCEEDED'): never {
  throw new RagProcessingError(code);
}

/** UTF-16 indices at complete Unicode-scalar boundaries. */
function boundaries(text: string): readonly number[] {
  const result = [0];
  let offset = 0;
  for (const scalar of text) {
    offset += scalar.length;
    result.push(offset);
  }
  return result;
}
function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0, high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}
function tokenCount(input: string): number {
  return countH9Cl100kTokens(input);
}
function fullInput(body: string, header: string): string {
  return header ? header + SEPARATOR + body : body;
}
function fits(body: string, header: string, cap: number): boolean {
  if (!body.trim() || body.length + header.length + (header ? SEPARATOR.length : 0) >
      H9_MAX_AUDIT_INPUT_CHARS) return false;
  return tokenCount(fullInput(body, header)) <= cap;
}
function contextHeader(source: OfflineChunkSource, block: LegalBlock, caput?: string): string {
  const crumb = [source.title, ...block.headingPath, block.articleLocator ?? ''].filter(Boolean).join(' › ');
  return caput ? crumb + '\n' + caput : crumb;
}
function headerChoices(
  source: OfflineChunkSource, block: LegalBlock, caput: string,
): readonly string[] {
  // Preserve the most informative breadcrumb first; the legal locator is
  // the minimum required header, never silently replace it with an empty one.
  return [...new Set([
    contextHeader(source, block, caput),
    contextHeader(source, block),
    block.articleLocator ?? source.sourceId,
  ])];
}

/**
 * Reserve capacity for the actual next Unicode scalar (including preceding
 * whitespace), not for an ASCII placeholder. Never split surrogate pairs.
 */
function firstMeaningfulScalarPrefix(text: string, start: number, end: number): string {
  let prefix = '';
  for (let at = start; at < end;) {
    const scalar = String.fromCodePoint(text.codePointAt(at)!);
    prefix += scalar;
    at += scalar.length;
    if (prefix.length > H9_MAX_AUDIT_INPUT_CHARS) fail('CHUNK_HEADER_TOO_LARGE');
    if (scalar.trim()) return prefix;
  }
  return fail('CHUNK_EMPTY');
}
function selectHeader(
  candidates: readonly string[], text: string, start: number, end: number, cap: number,
): string {
  const actualBodyPrefix = firstMeaningfulScalarPrefix(text, start, end);
  for (const header of candidates) {
    if (fits(actualBodyPrefix, header, cap)) return header;
  }
  return fail('CHUNK_HEADER_TOO_LARGE');
}
function unitIds(blocks: readonly LegalBlock[], start: number, end: number): readonly string[] {
  const set = new Set<string>();
  for (const block of blocks) {
    if (block.end <= start || block.start >= end) continue;
    if (block.articleLocator) set.add(block.articleLocator);
    if (block.kind !== 'heading') set.add(block.locator);
  }
  return Object.freeze([...set]);
}

/**
 * Token-based, scalar-safe segmenter. Binary-searches full rendered inputs, not
 * byte/character proxies. Only synthetic local calibration is in scope.
 * Optional overlap is measured in the same cl100k_base encoding, with progress.
 */
function splitTokenWindow(
  sourceText: string, positions: readonly number[], start: number, end: number,
  headerCandidates: readonly string[], maxTokens: number, overlapTokens: number,
): readonly { start: number; end: number; header: string }[] {
  const out: { start: number; end: number; header: string }[] = [];
  let from = start;
  while (from < end) {
    const startPos = lowerBound(positions, from);
    if (positions[startPos] !== from) fail('INVALID_DOCUMENT');
    // Re-evaluate at EVERY segment boundary: the next scalar may require more
    // tokens than the previous one, so a longer header can become unsafe.
    const header = selectHeader(headerCandidates, sourceText, from, end, maxTokens);
    const maxAllowedChars = H9_MAX_AUDIT_INPUT_CHARS - header.length - (header ? SEPARATOR.length : 0);
    const cap = Math.min(end, from + maxAllowedChars);
    let low = startPos + 1;
    let high = lowerBound(positions, cap + 1) - 1;
    let best = startPos;
    // Worst-case candidates are capped by countH9Cl100kTokens input policy.
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const trialEnd = positions[mid];
      if (fits(sourceText.slice(from, trialEnd), header, maxTokens)) {
        best = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (best === startPos) fail('CHUNK_HEADER_TOO_LARGE');
    let to = positions[best];
    if (to < end) {
      const span = sourceText.slice(from, to);
      const candidates = [...span.matchAll(/[.!?;]\s+/g)];
      const boundary = candidates.filter(m => (m.index ?? 0) >= span.length / 2).at(-1);
      const preferred = boundary ? from + (boundary.index ?? 0) + boundary[0].length : 0;
      if (preferred > from && positions[lowerBound(positions, preferred)] === preferred &&
          fits(sourceText.slice(from, preferred), header, maxTokens)) to = preferred;
    }
    out.push({ start: from, end: to, header });
    if (to === end) break;
    if (overlapTokens === 0) {
      from = to;
      continue;
    }
    // Rewind at most overlapTokens of BODY, never header; prevent an infinite loop.
    let rewind = startPos + 1;
    const nextPos = lowerBound(positions, to);
    let lo = rewind, hi = nextPos;
    // Earlier start => more overlap. Find earliest nonempty suffix within budget.
    rewind = nextPos;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid < nextPos && fits(sourceText.slice(positions[mid], to), '', overlapTokens)) {
        rewind = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    from = rewind < nextPos ? positions[rewind] : to;
    if (from <= out[out.length - 1].start) fail('CHUNK_TOO_LARGE');
  }
  return out;
}

/**
 * NEW versioned profile, strictly separate from historical utf8-byte-proxy@1.
 * Never exposes provider access or marks an official legal snapshot approved.
 */
export function renderH9TokenGridOffline(
  doc: NormalizedLegalDocument,
  fetched: FetchedDocument,
  source: OfflineChunkSource,
  config: H9TokenGridConfig,
): H9RenderedTokenSet {
  if (!doc || !fetched || !source || doc.sourceId !== source.sourceId ||
      fetched.sourceId !== source.sourceId ||
      sha256(doc.normalizedText) !== doc.normalizedSha256 ||
      !H9_TOKEN_GRID_PROFILES.some(p => p.strategy === config?.strategy &&
        p.maxTokens === config?.maxTokens && p.overlapTokens === config?.overlapTokens)) {
    fail('INVALID_DOCUMENT');
  }
  const profileId = pipelineProfileId({
    chunker: {
      strategy: config.strategy,
      maxTokens: config.maxTokens,
      overlapTokens: config.overlapTokens,
      tokenizer: 'cl100k_base/js-tiktoken@1.0.21',
      contextHeader: config.strategy === 'legal-structure' ? 'breadcrumb+caput' : 'none',
      // R2 changes legal headers on multi-token Unicode boundaries. Bump
      // the profile algorithm identity rather than reusing candidate @1 IDs.
      algorithmVersion: config.strategy === 'legal-structure'
        ? 'legal-structure-token-greedy@2' : 'recursive-token-window@1',
    },
    extractor: source.extractor,
    normalizer: 'legal-text@1',
  });
  const versionId = documentVersionId(fetched.documentId, fetched.contentSha256);
  const baseSetId = chunkSetId(versionId, profileId);
  const headerMetadataHash = config.strategy === 'legal-structure'
    ? sha256(canonicalJson({ sourceTitle: source.title })) : null;
  const setId = renderAwareChunkSetId(baseSetId, doc.normalizedSha256, headerMetadataHash);
  const sourceText = doc.normalizedText;
  const positions = boundaries(sourceText);
  const chunks: H9RenderedTokenChunk[] = [];
  let totalTokens = 0;

  function emit(start: number, end: number, header: string): void {
    if (start >= end || start < 0 || end > sourceText.length ||
        positions[lowerBound(positions, start)] !== start ||
        positions[lowerBound(positions, end)] !== end) fail('CHUNK_EMPTY');
    const body = sourceText.slice(start, end);
    const content = fullInput(body, header);
    if (!fits(body, header, config.maxTokens)) fail('CHUNK_TOO_LARGE');
    const count = tokenCount(content);
    totalTokens += count;
    if (chunks.length >= RAG_LIMITS.MAX_CHUNKS_PER_VERSION ||
        totalTokens > RAG_LIMITS.MAX_TOKENS_PER_JOB) fail('CHUNK_BUDGET_EXCEEDED');
    chunks.push(Object.freeze({
      id: chunkId(setId, chunks.length), ordinal: chunks.length,
      content, body, charStart: start, charEnd: end, tokenCount: count,
      articleLocator: doc.blocks.find(b => b.start < end && b.end > start)?.articleLocator ?? null,
      legalUnitIds: unitIds(doc.blocks, start, end),
    }));
  }
  function splitAndEmit(
    start: number, end: number, headerCandidates: readonly string[], overlap = 0,
  ): void {
    for (const s of splitTokenWindow(
      sourceText, positions, start, end, headerCandidates, config.maxTokens, overlap,
    )) emit(s.start, s.end, s.header);
  }
  if (config.strategy === 'recursive-baseline') {
    splitAndEmit(0, sourceText.length, [''], config.overlapTokens);
  } else {
    const groups: LegalBlock[][] = [];
    for (const block of doc.blocks) {
      if (!groups.length || block.kind === 'heading' || block.kind === 'article' ||
          groups[groups.length - 1][0].kind === 'heading') groups.push([block]);
      else groups[groups.length - 1].push(block);
    }
    for (const group of groups) {
      const first = group[0];
      if (first.kind === 'heading') continue;
      const start = first.start, end = group[group.length - 1].end;
      if (!first.articleLocator) {
        splitAndEmit(start, end, ['']);
        continue;
      }
      const headlineHeaders = headerChoices(source, first, '');
      const headline = selectHeader(headlineHeaders, sourceText, start, end, config.maxTokens);
      if (fits(sourceText.slice(start, end), headline, config.maxTokens)) {
        emit(start, end, headline);
        continue;
      }
      const caput = first.text;
      let pending: { start: number; end: number; header: string } | undefined;
      function flush(): void {
        if (!pending) return;
        emit(pending.start, pending.end, pending.header);
        pending = undefined;
      }
      for (const unit of group) {
        const headers = headerChoices(source, unit, unit === first ? '' : caput);
        const header = selectHeader(headers, sourceText, unit.start, unit.end, config.maxTokens);
        if (pending && pending.header === header &&
            fits(sourceText.slice(pending.start, unit.end), header, config.maxTokens)) {
          pending.end = unit.end;
          continue;
        }
        flush();
        if (fits(sourceText.slice(unit.start, unit.end), header, config.maxTokens)) {
          pending = { start: unit.start, end: unit.end, header };
        } else {
          splitAndEmit(unit.start, unit.end, headers);
        }
      }
      flush();
    }
  }
  if (chunks.length === 0) fail('CHUNK_EMPTY');
  return Object.freeze({
    provenance: 'synthetic-only-unverified-source',
    paidAdmissionApproved: false,
    profileId,
    chunkSetId: setId,
    normalizedSha256: doc.normalizedSha256,
    tokenizer: 'cl100k_base/js-tiktoken@1.0.21',
    identityVersion: 'rag:chunkset-rendered:v2',
    config: Object.freeze({ ...config }),
    totalTokens,
    chunks: Object.freeze(chunks),
  });
}
