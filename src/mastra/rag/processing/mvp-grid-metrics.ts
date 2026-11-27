import { performance } from 'node:perf_hooks';
import {
  canonicalJson, chunkId, chunkSetId, documentVersionId, ingestionIdempotencyKey,
  renderedIngestionIdempotencyKey, sha256,
} from '../contracts/ids.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { type OfflineChunkSource, renderAwareChunkSetId } from './chunk.ts';
import { countH9Cl100kTokens } from './cl100k-counter.ts';
import { RagProcessingError } from './errors.ts';
import type { LegalBlock, NormalizedLegalDocument } from './legal.ts';
import type { H9OfflineTokenSet, H9RenderedTokenChunk } from './token-grid.ts';

const SEPARATOR = '\n---\n';
const EMBEDDING_SPACE_ID = 'chunks_te3s_1536_v1';

type Span = Readonly<{ start: number; end: number }>;
type MeasuredChunk = Readonly<{ chunk: H9RenderedTokenChunk; header: string; index: number }>;
type CoverageRow = Readonly<{ fullyCovered: boolean; splitAcrossChunks: boolean }>;

function coverageCounts(rows: readonly CoverageRow[]) {
  return {
    total: rows.length,
    fullyCovered: rows.filter(row => row.fullyCovered).length,
    splitAcrossChunks: rows.filter(row => row.splitAcrossChunks).length,
  };
}

function isScalarBoundary(text: string, offset: number): boolean {
  const unit = text.charCodeAt(offset);
  return !(unit >= 0xdc00 && unit <= 0xdfff);
}

function isExplicitUnit(block: LegalBlock): boolean {
  return block.kind === 'article' || block.kind === 'inciso' || block.kind === 'alinea' ||
    (block.kind === 'paragraph' && /^(?:§\s*\d|Par[aá]grafo\s+[uú]nico\b)/iu.test(block.text));
}

function mergeSpans(spans: readonly Span[]): readonly Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, span.end) };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

function blockCoverage(doc: NormalizedLegalDocument, chunks: readonly MeasuredChunk[]) {
  const headingByLabel = new Map<string, LegalBlock>();
  return doc.blocks.map(block => {
    if (block.kind === 'heading') headingByLabel.set(block.text, block);
    const relevant = chunks.filter(({ chunk }) =>
      chunk.charStart < block.end && chunk.charEnd > block.start);
    const headings = new Set(block.headingPath.flatMap(label => [label, ...label.split(' — ')])
      .flatMap(label => {
        const heading = headingByLabel.get(label);
        return heading ? [heading] : [];
      }));

    // Rebuild each block from the chunk bodies, dropping only offsets already covered.
    let cursor = block.start;
    let rebuilt = '';
    for (const { chunk } of relevant) {
      const start = Math.max(cursor, chunk.charStart);
      const end = Math.min(block.end, chunk.charEnd);
      if (start < end) {
        rebuilt += chunk.body.slice(start - chunk.charStart, end - chunk.charStart);
        cursor = end;
      }
    }

    const fullyCovered = rebuilt === block.text;
    const splitAcrossChunks = fullyCovered && !relevant.some(({ chunk }) =>
      chunk.charStart <= block.start && chunk.charEnd >= block.end);
    const locatorPreserved = fullyCovered && relevant.every(({ chunk }) =>
      chunk.legalUnitIds.includes(block.locator) &&
      (!block.articleLocator || chunk.legalUnitIds.includes(block.articleLocator)));
    return { block, relevant, headings, fullyCovered, splitAcrossChunks, locatorPreserved };
  });
}

function structuralMetrics(
  doc: NormalizedLegalDocument, source: OfflineChunkSource, chunks: readonly MeasuredChunk[],
) {
  const rows = blockCoverage(doc, chunks);
  const normative = rows.filter(({ block }) => block.kind !== 'heading');
  const headingRows = rows.filter(({ block }) => block.kind === 'heading');
  const explicitUnits = normative.filter(({ block }) => isExplicitUnit(block));
  const explicitPerChunk = new Map<number, number>();
  const expectedLocators = new Map<number, { firstArticle: string | null; ids: Set<string> }>();
  const articleScopes = new Map<string, typeof rows>();
  const annexScopes = new Map<string, typeof rows>();
  const caputByLocator = new Map(explicitUnits.filter(({ block }) => block.kind === 'article')
    .map(({ block }) => [block.locator, block] as const));
  const chunksWithFullBreadcrumbs = new Set<number>();
  const headingsCarriedByHeader = new Set<LegalBlock>();
  const articleScopedBlocks = normative.filter(({ block }) => block.articleLocator !== null);
  let articleScopedBlocksWithContext = 0;
  let articleScopedBlocksWithBreadcrumbs = 0;

  for (const { block, relevant } of rows) {
    for (const { index } of relevant) {
      const expected = expectedLocators.get(index) ?? { firstArticle: block.articleLocator, ids: new Set() };
      if (block.articleLocator) expected.ids.add(block.articleLocator);
      if (block.kind !== 'heading') expected.ids.add(block.locator);
      expectedLocators.set(index, expected);
    }
  }

  for (const row of normative) {
    const { block, relevant, headings } = row;
    const annex = /^(.*:anexo[1-9][0-9]*):/.exec(block.locator)?.[1];
    if (annex) {
      const scope = annexScopes.get(annex) ?? [];
      scope.push(row);
      annexScopes.set(annex, scope);
    }
    if (!block.articleLocator) continue;
    const articleScope = articleScopes.get(block.articleLocator) ?? [];
    articleScope.push(row);
    articleScopes.set(block.articleLocator, articleScope);
    const caput = caputByLocator.get(block.articleLocator);
    const breadcrumb = [source.title, ...block.headingPath, block.articleLocator].filter(Boolean).join(' › ');
    const breadcrumbs = relevant.filter(({ header }) =>
      header === breadcrumb || (caput && header === breadcrumb + '\n' + caput.text));
    for (const { index } of breadcrumbs) chunksWithFullBreadcrumbs.add(index);
    if (breadcrumbs.length) for (const heading of headings) headingsCarriedByHeader.add(heading);
    if (row.fullyCovered && breadcrumbs.length === relevant.length) articleScopedBlocksWithBreadcrumbs++;
    if (row.fullyCovered && relevant.every(candidate => {
      const { chunk } = candidate;
      return breadcrumbs.includes(candidate) || (caput &&
        chunk.charStart <= caput.start && chunk.charEnd >= caput.end &&
        [...headings].every(heading => chunk.charStart <= heading.start && chunk.charEnd >= heading.end));
    })) articleScopedBlocksWithContext++;
  }

  for (const { relevant } of explicitUnits) {
    for (const { index } of relevant) {
      explicitPerChunk.set(index, (explicitPerChunk.get(index) ?? 0) + 1);
    }
  }

  function scopeCoverage(scopes: ReadonlyMap<string, typeof rows>) {
    return coverageCounts([...scopes.values()].map(scope => {
      const start = scope[0].block.start;
      const end = scope[scope.length - 1].block.end;
      const fullyCovered = scope.every(row => row.fullyCovered);
      return {
        fullyCovered,
        splitAcrossChunks: fullyCovered && !scope[0].relevant.some(({ chunk }) =>
          chunk.charStart <= start && chunk.charEnd >= end),
      };
    }));
  }
  return {
    coverage: {
      normalizedBlocks: coverageCounts(rows),
      normativeBlocks: coverageCounts(normative),
      articles: coverageCounts(explicitUnits.filter(({ block }) => block.kind === 'article')),
      articleScopes: scopeCoverage(articleScopes),
      incisos: coverageCounts(explicitUnits.filter(({ block }) => block.kind === 'inciso')),
      paragraphs: coverageCounts(explicitUnits.filter(({ block }) => block.kind === 'paragraph')),
      alineas: coverageCounts(explicitUnits.filter(({ block }) => block.kind === 'alinea')),
      annexes: scopeCoverage(annexScopes),
      headings: coverageCounts(headingRows),
      explicitUnits: coverageCounts(explicitUnits),
    },
    structure: {
      explicitLocatorsExpected: explicitUnits.length,
      explicitLocatorsPreserved: explicitUnits.filter(row => row.locatorPreserved).length,
      locatorMetadataMismatches: chunks.filter(({ chunk, index }) => {
        const expected = expectedLocators.get(index);
        const ids = [...expected?.ids ?? []];
        return chunk.articleLocator !== (expected?.firstArticle ?? null) ||
          chunk.legalUnitIds.length !== ids.length ||
          chunk.legalUnitIds.some((id, at) => id !== ids[at]);
      }).length,
      articleScopedBlocks: articleScopedBlocks.length,
      articleScopedBlocksWithContext,
      articleScopedBlocksWithBreadcrumbs,
      chunksWithFullBreadcrumbs: chunksWithFullBreadcrumbs.size,
      headingsRepresentedByBreadcrumb: headingRows.filter(({ block, fullyCovered }) =>
        !fullyCovered && headingsCarriedByHeader.has(block)).length,
      chunksWithMultipleLegalUnits: [...explicitPerChunk.values()].filter(count => count > 1).length,
      chunksWithMultipleArticles: chunks.filter(({ chunk }) =>
        chunk.legalUnitIds.filter(locator => caputByLocator.has(locator)).length > 1).length,
    },
  };
}

function tokenSummary(tokenCounts: readonly number[]) {
  const sorted = [...tokenCounts].sort((a, b) => a - b);
  const totalTokens = sorted.reduce((sum, count) => sum + count, 0);
  return {
    count: sorted.length,
    totalTokens,
    meanTokens: sorted.length ? totalTokens / sorted.length : 0,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? 0,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}

export function measureMvpGrid(
  doc: NormalizedLegalDocument, fetched: FetchedDocument, source: OfflineChunkSource,
  set: H9OfflineTokenSet,
) {
  const text = doc.normalizedText;
  const structural = set.config.strategy === 'legal-structure';
  const tokenizationStarted = performance.now();
  const tokenCounts = set.chunks.map(chunk => countH9Cl100kTokens(chunk.content));
  const tokenizationMs = performance.now() - tokenizationStarted;
  const chunking = {
    ...tokenSummary(tokenCounts),
    overLimit: tokenCounts.filter(count => count > set.config.maxTokens).length,
    tokenCountMismatches: set.chunks.filter((chunk, index) => chunk.tokenCount !== tokenCounts[index]).length,
    totalTokenCountMismatches: 0,
    renderedInputMismatches: 0,
    headerAndSeparatorTokens: 0,
    repeatedHeaderAndSeparatorTokens: 0,
    intentionalOverlapTokens: 0,
  };
  if (set.totalTokens !== chunking.totalTokens) chunking.totalTokenCountMismatches++;

  const seenHeaders = new Set<string>();
  const validChunks: MeasuredChunk[] = [];
  let offsetMismatches = 0;
  for (const [index, chunk] of set.chunks.entries()) {
    const prefix = chunk.content.slice(0, chunk.content.length - chunk.body.length);
    const prefixValid = chunk.content === prefix + chunk.body &&
      (!prefix || (structural && prefix.length > SEPARATOR.length && prefix.endsWith(SEPARATOR)));
    if (!prefixValid) chunking.renderedInputMismatches++;
    const header = prefixValid && prefix ? prefix.slice(0, -SEPARATOR.length) : '';
    if (header) {
      // Marginal count under BPE. Tokenizing the header on its own may tokenize the seam differently.
      const added = tokenCounts[index] - countH9Cl100kTokens(chunk.body);
      chunking.headerAndSeparatorTokens += added;
      if (seenHeaders.has(header)) chunking.repeatedHeaderAndSeparatorTokens += added;
      seenHeaders.add(header);
    }
    if (!Number.isSafeInteger(chunk.charStart) || !Number.isSafeInteger(chunk.charEnd) ||
        chunk.charStart < 0 || chunk.charEnd > text.length || chunk.charEnd <= chunk.charStart ||
        !isScalarBoundary(text, chunk.charStart) || !isScalarBoundary(text, chunk.charEnd) ||
        text.slice(chunk.charStart, chunk.charEnd) !== chunk.body) {
      offsetMismatches++;
    } else {
      validChunks.push({ chunk, header, index });
    }
  }

  let normalizedOffsetMismatches = 0;
  let blockEnd = 0;
  for (const [index, block] of doc.blocks.entries()) {
    const separator = index === 0 ? '' : '\n\n';
    if (block.start !== blockEnd + separator.length ||
        text.slice(blockEnd, block.start) !== separator ||
        !isScalarBoundary(text, block.start) || !isScalarBoundary(text, block.end) ||
        block.end <= block.start || block.end > text.length ||
        text.slice(block.start, block.end) !== block.text) normalizedOffsetMismatches++;
    blockEnd = block.end;
  }
  if (blockEnd !== text.length) normalizedOffsetMismatches++;

  let intentionalOverlapUtf16 = 0;
  let orderMismatches = 0;
  let furthestEnd = 0;
  for (const [index, { chunk }] of validChunks.entries()) {
    const previous = validChunks[index - 1]?.chunk;
    if (previous && (chunk.charStart <= previous.charStart || chunk.charEnd <= furthestEnd)) {
      orderMismatches++;
    } else if (!structural && previous?.charEnd === furthestEnd && chunk.charStart < furthestEnd) {
      const repeated = text.slice(chunk.charStart, furthestEnd);
      if (repeated.trim()) {
        const count = countH9Cl100kTokens(repeated);
        if (count <= set.config.overlapTokens) {
          chunking.intentionalOverlapTokens += count;
          intentionalOverlapUtf16 += repeated.length;
        }
      }
    }
    furthestEnd = Math.max(furthestEnd, chunk.charEnd);
  }

  const sorted = [...validChunks].sort((a, b) => a.chunk.charStart - b.chunk.charStart);
  const spans = sorted.map(({ chunk }) => ({ start: chunk.charStart, end: chunk.charEnd }));
  const union = mergeSpans(spans);
  const total = (ranges: readonly Span[]) => ranges.reduce((sum, span) => sum + span.end - span.start, 0);
  const coveredUtf16 = total(union);
  const sourceCoverage = structuralMetrics(doc, source, sorted);
  let expectedOmittedHeadingUtf16 = 0;
  let expectedOmittedSeparatorUtf16 = 0;
  if (structural && normalizedOffsetMismatches === 0) {
    for (const [index, block] of doc.blocks.entries()) {
      if (block.kind === 'heading' &&
          !union.some(span => span.start < block.end && span.end > block.start)) {
        expectedOmittedHeadingUtf16 += block.end - block.start;
      }
      if (index > 0) {
        const start = doc.blocks[index - 1].end;
        const included = union.reduce((sum, span) =>
          sum + Math.max(0, Math.min(block.start, span.end) - Math.max(start, span.start)), 0);
        expectedOmittedSeparatorUtf16 += block.start - start - included;
      }
    }
  }
  const offsets = {
    sourceUtf16: text.length,
    coveredUtf16,
    offsetMismatches,
    normalizedOffsetMismatches,
    orderMismatches,
    expectedOmittedHeadingUtf16,
    expectedOmittedSeparatorUtf16,
    unexpectedGapUtf16: text.length - coveredUtf16 - expectedOmittedHeadingUtf16 - expectedOmittedSeparatorUtf16,
    intentionalOverlapUtf16,
    unexpectedDuplicateUtf16: total(spans) - coveredUtf16 - intentionalOverlapUtf16,
  };

  const versionId = documentVersionId(fetched.documentId, fetched.contentSha256);
  const baseSetId = chunkSetId(versionId, set.profileId);
  const headerMetadataSha256 = structural ? sha256(canonicalJson({ sourceTitle: source.title })) : null;
  const setId = renderAwareChunkSetId(baseSetId, doc.normalizedSha256, headerMetadataSha256);
  const chunkIds = set.chunks.map(chunk => chunk.id);
  const identity = {
    documentId: fetched.documentId,
    documentVersionId: set.versionId,
    profileId: set.profileId,
    baseChunkSetId: set.baseChunkSetId,
    renderedChunkSetId: set.chunkSetId,
    identityVersion: set.identityVersion,
    headerMetadataSha256: set.headerMetadataSha256,
    normalizedSha256: set.normalizedSha256,
    renderedSha256: sha256(canonicalJson(set.chunks.map(chunk => sha256(chunk.content)))),
    chunkMetadataSha256: sha256(canonicalJson(set.chunks.map(chunk => ({
      id: chunk.id, start: chunk.charStart, end: chunk.charEnd, articleLocator: chunk.articleLocator,
      legalUnitIds: chunk.legalUnitIds,
    })))),
    chunkIds,
    v1IdempotencyKey: ingestionIdempotencyKey(
      fetched.documentId, fetched.contentSha256, set.profileId, EMBEDDING_SPACE_ID,
    ),
    v2IdempotencyKey: renderedIngestionIdempotencyKey(fetched.documentId, set.chunkSetId, EMBEDDING_SPACE_ID),
    verified: set.versionId === versionId && set.baseChunkSetId === baseSetId &&
      set.chunkSetId === setId && set.headerMetadataSha256 === headerMetadataSha256 &&
      set.normalizedSha256 === doc.normalizedSha256 && set.normalizedSha256 === sha256(text) &&
      set.chunks.every((chunk, index) => chunk.ordinal === index && chunk.id === chunkId(setId, index)),
  };
  const { coverage, structure } = sourceCoverage;
  const verified = set.chunks.length > 0 && chunking.overLimit === 0 && chunking.tokenCountMismatches === 0 &&
    chunking.totalTokenCountMismatches === 0 && chunking.renderedInputMismatches === 0 &&
    offsets.offsetMismatches === 0 && offsets.normalizedOffsetMismatches === 0 &&
    offsets.orderMismatches === 0 && offsets.unexpectedGapUtf16 === 0 &&
    offsets.unexpectedDuplicateUtf16 === 0 &&
    coverage.normativeBlocks.fullyCovered === coverage.normativeBlocks.total &&
    structure.explicitLocatorsPreserved === structure.explicitLocatorsExpected &&
    structure.locatorMetadataMismatches === 0 && identity.verified;

  return { tokenCounts, tokenizationMs, metrics: { chunking, coverage, structure, offsets, identity, verified } };
}

type MvpGridMeasurement = ReturnType<typeof measureMvpGrid>;

function sumFields<T extends Record<string, number>>(records: readonly [T, ...T[]]): T {
  const fields = Object.keys(records[0]) as (keyof T)[];
  return Object.fromEntries(fields.map(field => [
    field, records.reduce((sum, row) => sum + row[field], 0),
  ])) as T;
}

export function aggregateMvpGrid(measurements: readonly MvpGridMeasurement[]) {
  const [first, ...rest] = measurements;
  if (!first) throw new RagProcessingError('CHUNK_EMPTY');
  const total = <T extends Record<string, number>>(select: (row: MvpGridMeasurement['metrics']) => T) =>
    sumFields([select(first.metrics), ...rest.map(measurement => select(measurement.metrics))]);
  const coverageKeys = Object.keys(first.metrics.coverage) as (keyof typeof first.metrics.coverage)[];
  return {
    chunking: {
      ...total(metrics => metrics.chunking),
      ...tokenSummary(measurements.flatMap(measurement => measurement.tokenCounts)),
    },
    coverage: Object.fromEntries(coverageKeys.map(key => [
      key, total(metrics => metrics.coverage[key]),
    ])) as typeof first.metrics.coverage,
    structure: total(metrics => metrics.structure),
    offsets: total(metrics => metrics.offsets),
    verified: measurements.every(measurement => measurement.metrics.verified),
  };
}
