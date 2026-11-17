import { canonicalJson, chunkId, chunkSetId, documentVersionId, pipelineProfileId, sha256 } from '../contracts/ids.ts';
import { RAG_LIMITS, type FetchedDocument, type SourceManifestEntry } from '../contracts/types.ts';
import { RagProcessingError } from './errors.ts';
import type { LegalBlock, NormalizedLegalDocument } from './legal.ts';

export type ChunkStrategy = 'legal-structure' | 'recursive-baseline';
export type OfflineChunkConfig = Readonly<{
  strategy: ChunkStrategy;
  maxBytes: number;
  overlapBytes: number;
}>;
export const STRUCTURAL_PROXY_CONFIG: OfflineChunkConfig = Object.freeze({
  strategy: 'legal-structure', maxBytes: 512, overlapBytes: 0,
});
export const RECURSIVE_PROXY_CONFIG: OfflineChunkConfig = Object.freeze({
  strategy: 'recursive-baseline', maxBytes: 400, overlapBytes: 60,
});

export type OfflineChunk = Readonly<{
  id: string;
  ordinal: number;
  content: string;
  body: string;
  charStart: number;
  charEnd: number;
  byteCount: number;
  articleLocator: string | null;
  legalUnitIds: readonly string[];
}>;

export type OfflineChunkSet = Readonly<{
  versionId: string;
  profileId: string;
  chunkSetId: string;
  /** Hash of the external metadata that affects rendered context headers. */
  headerMetadataSha256: string | null;
  tokenizer: 'utf8-byte-proxy@1';
  strategy: ChunkStrategy;
  chunks: readonly OfflineChunk[];
  totalByteBudget: number;
}>;

/**
 * This is a deliberately conservative UTF-8 BYTE budget, NOT a measured
 * cl100k_base token count. H9 must approve a tokenizer and the gold-set
 * calibration must run before any paid embedding call.
 */
function size(text: string): number { return Buffer.byteLength(text, 'utf8'); }

function deriveUnitIds(blocks: readonly LegalBlock[], start: number, end: number): readonly string[] {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.start >= end || b.end <= start) continue;
    if (b.articleLocator) ids.add(b.articleLocator);
    if (b.kind !== 'heading') ids.add(b.locator);
  }
  return Object.freeze([...ids]);
}

function splitWithinBudget(
  text: string, offset: number, maxBodyBytes: number, overlapBytes = 0,
): ReadonlyArray<{ start: number; end: number }> {
  if (maxBodyBytes < 8) throw new RagProcessingError('CHUNK_HEADER_TOO_LARGE');
  const pieces: { start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let bytes = 0;
    for (const char of text.slice(start)) {
      const n = size(char);
      if (bytes + n > maxBodyBytes) break;
      bytes += n;
      end += char.length;
    }
    if (end <= start) throw new RagProcessingError('CHUNK_TOO_LARGE');
    if (end < text.length) {
      const trial = text.slice(start, end);
      // Prefer a sentence boundary inside the last half of the budget.
      const candidates = [...trial.matchAll(/[.!?;]\s+/g)];
      const boundary = candidates.filter(m => (m.index ?? 0) > trial.length / 2).at(-1);
      if (boundary) end = start + (boundary.index ?? 0) + boundary[0].length;
    }
    pieces.push({ start: offset + start, end: offset + end });
    if (end === text.length) break;
    if (!overlapBytes) {
      start = end;
    } else {
      let rewind = 0;
      let nextStart = end;
      for (const char of Array.from(text.slice(start, end)).reverse()) {
        const n = size(char);
        if (rewind + n > overlapBytes) break;
        rewind += n;
        nextStart -= char.length;
      }
      const firstCodePointLength = Array.from(text.slice(start, end))[0]?.length ?? 1;
      start = Math.max(start + firstCodePointLength, nextStart);
    }
  }
  return pieces;
}

function contextHeader(source: SourceManifestEntry, block: LegalBlock, caput?: string): string {
  const crumb = [source.title, ...block.headingPath, block.articleLocator ?? ''].filter(Boolean).join(' › ');
  return caput ? crumb + '\n' + caput : crumb;
}

const HEADER_SEPARATOR_BYTES = Buffer.byteLength('\n---\n', 'utf8');
const MIN_SPLIT_BODY_BYTES = 8;

function chooseHeader(source: SourceManifestEntry, block: LegalBlock, caput: string, maxBytes: number): string {
  const hasBodyRoom = (header: string): boolean =>
    size(header) + HEADER_SEPARATOR_BYTES + MIN_SPLIT_BODY_BYTES <= maxBytes;
  const detailed = contextHeader(source, block, caput);
  if (hasBodyRoom(detailed)) return detailed;
  const simple = contextHeader(source, block);
  if (hasBodyRoom(simple)) return simple;
  // Title/path may be huge even if body is short. Keep only the locator.
  const minimal = block.articleLocator ?? source.sourceId;
  if (!hasBodyRoom(minimal)) throw new RagProcessingError('CHUNK_HEADER_TOO_LARGE');
  return minimal;
}

export function makeOfflineChunkSet(
  doc: NormalizedLegalDocument,
  fetched: FetchedDocument,
  source: SourceManifestEntry,
  config: OfflineChunkConfig = STRUCTURAL_PROXY_CONFIG,
): OfflineChunkSet {
  if (fetched.sourceId !== source.sourceId || doc.sourceId !== source.sourceId ||
      !Number.isSafeInteger(config.maxBytes) || config.maxBytes < 32 ||
      config.maxBytes > RAG_LIMITS.HARD_MAX_CHUNK_TOKENS ||
      !Number.isSafeInteger(config.overlapBytes) || config.overlapBytes < 0 ||
      config.overlapBytes >= config.maxBytes ||
      (config.strategy !== 'legal-structure' && config.strategy !== 'recursive-baseline')) {
    throw new RagProcessingError('INVALID_DOCUMENT');
  }
  const profileId = pipelineProfileId({
    chunker: {
      strategy: config.strategy, maxBytes: config.maxBytes, overlapBytes: config.overlapBytes,
      contextHeader: config.strategy === 'legal-structure' ? 'breadcrumb+caput' : 'none',
      tokenizer: 'utf8-byte-proxy@1',
    },
    extractor: source.extractor, normalizer: 'legal-text@1',
  });
  const versionId = documentVersionId(fetched.documentId, fetched.contentSha256);
  const baseSetId = chunkSetId(versionId, profileId);
  // Step C rendering v1: keep the pipeline profile reusable across sources;
  // changing the manifest title must create a distinct chunk set and IDs.
  // Recursive baseline has no source-title header, so it keeps the base ID.
  const headerMetadataSha256 = config.strategy === 'legal-structure'
    ? sha256(canonicalJson({ sourceTitle: source.title }))
    : null;
  const setId = headerMetadataSha256 === null
    ? baseSetId
    : sha256(['rag:chunkset-rendered:v1', baseSetId, headerMetadataSha256].join('\n'));
  const text = doc.normalizedText;
  const result: OfflineChunk[] = [];
  let totalByteBudget = 0;

  const emit = (start: number, end: number, header: string): void => {
    if (start >= end || start < 0 || end > text.length) throw new RagProcessingError('CHUNK_EMPTY');
    const body = text.slice(start, end);
    const content = header ? header + '\n---\n' + body : body;
    const byteCount = size(content);
    if (byteCount > config.maxBytes) throw new RagProcessingError('CHUNK_TOO_LARGE');
    totalByteBudget += byteCount;
    if (result.length >= RAG_LIMITS.MAX_CHUNKS_PER_VERSION ||
        totalByteBudget > RAG_LIMITS.MAX_TOKENS_PER_JOB) {
      throw new RagProcessingError('CHUNK_BUDGET_EXCEEDED');
    }
    result.push(Object.freeze({
      id: chunkId(setId, result.length), ordinal: result.length,
      content, body, charStart: start, charEnd: end, byteCount,
      articleLocator: doc.blocks.find(b => b.start < end && b.end > start)?.articleLocator ?? null,
      legalUnitIds: deriveUnitIds(doc.blocks, start, end),
    }));
  };

  if (config.strategy === 'recursive-baseline') {
    const segments = splitWithinBudget(text, 0, config.maxBytes, config.overlapBytes);
    for (const segment of segments) emit(segment.start, segment.end, '');
  } else {
    const groups: LegalBlock[][] = [];
    for (const b of doc.blocks) {
      if (!groups.length || b.kind === 'article' || b.kind === 'heading' ||
          groups[groups.length - 1][0].kind === 'heading') {
        groups.push([b]);
      } else {
        groups[groups.length - 1].push(b);
      }
    }
    for (const group of groups) {
      const first = group[0];
      const from = first.start;
      const to = group[group.length - 1].end;
      // Non-normative chapter/section headings are kept in the normalized
      // source for provenance and headers, but are never standalone vectors.
      if (first.kind === 'heading') continue;
      if (!first.articleLocator) {
        for (const segment of splitWithinBudget(text.slice(from, to), from, config.maxBytes)) {
          emit(segment.start, segment.end, '');
        }
        continue;
      }
      const header = chooseHeader(source, first, '', config.maxBytes);
      if (size(header + '\n---\n' + text.slice(from, to)) <= config.maxBytes) {
        emit(from, to, header);
        continue;
      }
      const caput = first.text;
      for (const unit of group) {
        const unitHeader = chooseHeader(source, unit, unit === first ? '' : caput, config.maxBytes);
        const maxBody = config.maxBytes - size(unitHeader) - 5;
        for (const piece of splitWithinBudget(text.slice(unit.start, unit.end), unit.start, maxBody)) {
          emit(piece.start, piece.end, unitHeader);
        }
      }
    }
  }
  if (!result.length) throw new RagProcessingError('CHUNK_EMPTY');
  return Object.freeze({
    versionId, profileId, chunkSetId: setId, headerMetadataSha256,
    tokenizer: 'utf8-byte-proxy@1',
    strategy: config.strategy,
    chunks: Object.freeze(result),
    totalByteBudget,
  });
}
