import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  canonicalJson, chunkId, chunkSetId, documentId, documentVersionId,
  ingestionIdempotencyKey, renderedIngestionIdempotencyKey, sha256,
} from '../src/mastra/rag/contracts/ids.ts';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import {
  RAG_LIMITS, type FetchedDocument, type SourceManifestEntry,
} from '../src/mastra/rag/contracts/types.ts';
import {
  makeOfflineChunkSet, RECURSIVE_PROXY_CONFIG, renderAwareChunkSetId, STRUCTURAL_PROXY_CONFIG,
} from '../src/mastra/rag/processing/chunk.ts';
import { decodeFetchedDocument } from '../src/mastra/rag/processing/decode.ts';
import {
  DOU_EXTRACTOR_CANDIDATE, DouHtmlCandidateError, extractDouHtmlCandidate,
} from '../src/mastra/rag/processing/dou-html.ts';
import { normalizeDouLegalBlocks } from '../src/mastra/rag/processing/dou-legal.ts';
import { RagProcessingError } from '../src/mastra/rag/processing/errors.ts';
import type { NormalizedLegalDocument } from '../src/mastra/rag/processing/legal.ts';
import { openH9CPrivateArchiveDirectory } from '../src/mastra/rag/processing/private-archive.ts';
import {
  inspectH9CQuarantinedEvidence, type H9CQuarantineReceipt,
} from '../src/mastra/rag/processing/quarantine-inspection.ts';
import { assessH9CQuarantinedResponse } from '../src/mastra/rag/processing/source-quarantine.ts';

const SHA256 = /^[a-f0-9]{64}$/;
const LOCATOR_METADATA_DIGEST = 'h9c-c2-locator-metadata:v1';
const APPROVAL_FLAGS = Object.freeze({
  officialLegalTextAccepted: false,
  snapshotSemanticallyReviewed: false,
  paidAdmissionApproved: false,
} as const);

type OperatorReceipt = H9CQuarantineReceipt & Readonly<{
  extractor: string;
  declaredMediaType: string;
  fetchedAt: string;
  decodedSha256: string;
  normalizedSha256: string | null;
  blocks: number | null;
}>;

function invalidEvidence(): never {
  throw new Error('H9C_C2_INVALID_EVIDENCE');
}

function readSelectedPair(
  directory: string, source: SourceManifestEntry, rawSha256: string, receiptSha256: string,
) {
  const archive = openH9CPrivateArchiveDirectory(directory);
  try {
    const basename = source.sourceId + '-' + rawSha256;
    const receiptBytes = archive.readEvidenceBytes(basename + '.receipt.json', 16_384);
    if (sha256(receiptBytes) !== receiptSha256) invalidEvidence();
    const receipt: OperatorReceipt = JSON.parse(new TextDecoder('utf-8', { fatal: true })
      .decode(receiptBytes));
    if (receipt?.sourceId !== source.sourceId || receipt.rawSha256 !== rawSha256 ||
        receipt.extractor !== source.extractor ||
        typeof receipt.declaredMediaType !== 'string' ||
        !/^text\/html(?:\s*;|$)/i.test(receipt.declaredMediaType.trim()) ||
        typeof receipt.fetchedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.fetchedAt) ||
        !Number.isFinite(Date.parse(receipt.fetchedAt)) ||
        new Date(receipt.fetchedAt).toISOString() !== receipt.fetchedAt ||
        typeof receipt.decodedSha256 !== 'string' || !SHA256.test(receipt.decodedSha256)) {
      invalidEvidence();
    }
    const bytes = archive.readEvidenceBytes(basename + '.source.html', RAG_LIMITS.MAX_RAW_BYTES);
    inspectH9CQuarantinedEvidence(bytes, receipt);
    if (receipt.extractionStatus === 'unsupported'
      ? receipt.normalizedSha256 !== null || receipt.blocks !== null
      : typeof receipt.normalizedSha256 !== 'string' || !SHA256.test(receipt.normalizedSha256) ||
        receipt.blocks === null || !Number.isSafeInteger(receipt.blocks) || receipt.blocks < 1) {
      invalidEvidence();
    }
    const fetched: FetchedDocument = {
      sourceId: source.sourceId,
      documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
      canonicalUri: source.canonicalUri,
      finalUri: receipt.finalUri,
      httpStatus: 200,
      declaredMediaType: receipt.declaredMediaType,
      sniffedMediaType: 'text/html',
      charset: receipt.charset,
      byteSize: receipt.byteSize,
      contentSha256: rawSha256,
      fetchedAt: receipt.fetchedAt,
      bytes,
    };
    const decoded = decodeFetchedDocument(fetched, source);
    const decodedSha256 = sha256(decoded);
    if (decodedSha256 !== receipt.decodedSha256) invalidEvidence();
    return { fetched, decoded, decodedSha256, receipt };
  } finally {
    archive.close();
  }
}

function scalarBoundary(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return !(unit >= 0xdc00 && unit <= 0xdfff);
}

function summarizeNormalized(doc: NormalizedLegalDocument) {
  const structuralCounts = { heading: 0, article: 0, paragraph: 0, inciso: 0, alinea: 0, preamble: 0 };
  const articleLocators = new Set<string>();
  const headingDigests = new Map<string, string>();
  const metadataHasher = createHash('sha256').update(LOCATOR_METADATA_DIGEST + '\n');
  let explicitParagraphs = 0;
  let duplicateArticleLocators = 0;
  let annexArticles = 0;
  let annexBlocks = 0;
  let annexStart = -1;
  let annexEnd = 0;
  let blocksWithHeadingContext = 0;
  let annotations = 0;
  let verifiedUtf16Offsets = 0;
  let expectedStart = 0;
  for (const block of doc.blocks) {
    structuralCounts[block.kind]++;
    if (block.kind === 'paragraph' && /^(?:§\s*\d|Par[aá]grafo\s+[uú]nico\b)/iu.test(block.text)) {
      explicitParagraphs++;
    }
    if (block.headingPath.length) blocksWithHeadingContext++;
    annotations += block.annotations.length;
    const inAnnex = /:anexo[1-9][0-9]*:/.test(block.locator);
    if (inAnnex) {
      annexBlocks++;
      if (annexStart < 0) annexStart = block.start;
      annexEnd = block.end;
      if (block.kind === 'article') annexArticles++;
    }
    if (block.kind === 'article') {
      if (articleLocators.has(block.locator)) duplicateArticleLocators++;
      articleLocators.add(block.locator);
    }
    if (block.start === expectedStart && block.end > block.start &&
        block.end <= doc.normalizedText.length &&
        scalarBoundary(doc.normalizedText, block.start) &&
        scalarBoundary(doc.normalizedText, block.end) &&
        doc.normalizedText.slice(block.start, block.end) === block.text) verifiedUtf16Offsets++;
    expectedStart = block.end + 2;
    const headingPathSha256 = block.headingPath.map(label => {
      const existing = headingDigests.get(label);
      if (existing !== undefined) return existing;
      const digest = sha256(label);
      headingDigests.set(label, digest);
      return digest;
    });
    // Stream one canonical record per legal unit. Each repeated label occupies
    // only a fixed-size digest in the record, independent of its text length.
    metadataHasher.update(canonicalJson({
      kind: block.kind,
      start: block.start,
      end: block.end,
      locator: block.locator,
      articleLocator: block.articleLocator,
      headingPathSha256,
    }) + '\n');
  }
  return {
    normalizedSha256: doc.normalizedSha256,
    normalizedUtf16: doc.normalizedText.length,
    blockCount: doc.blocks.length,
    structuralCounts,
    explicitParagraphs,
    duplicateArticleLocators,
    annexArticles,
    annexBlocks,
    annexUtf16: annexStart < 0 ? 0 : annexEnd - annexStart,
    blocksWithHeadingContext,
    annotations,
    verifiedUtf16Offsets,
    locatorMetadataDigest: LOCATOR_METADATA_DIGEST,
    locatorMetadataSha256: metadataHasher.digest('hex'),
  };
}

function candidateIteration(decoded: string, source: SourceManifestEntry) {
  const started = performance.now();
  let extraction: ReturnType<typeof extractDouHtmlCandidate>;
  try {
    extraction = extractDouHtmlCandidate(decoded);
  } catch (error) {
    if (!(error instanceof DouHtmlCandidateError)) throw error;
    const extractionMs = performance.now() - started;
    return {
      summary: {
        classification: error.code,
        ...error.diagnostics,
        structuralCompleteness: 'incomplete',
        blockCount: null,
        extractedBlocksSha256: null,
        normalization: null,
      },
      extractionMs,
      normalizationMs: null,
    };
  }
  const extractionMs = performance.now() - started;
  const normalizationStarted = performance.now();
  let normalized: NormalizedLegalDocument;
  try {
    normalized = normalizeDouLegalBlocks(extraction.blocks, source);
  } catch (error) {
    if (!(error instanceof RagProcessingError)) throw error;
    const normalizationMs = performance.now() - normalizationStarted;
    return {
      summary: {
        classification: 'DOU_CANDIDATE_STRUCTURAL_INCOMPLETE',
        ...extraction.diagnostics,
        structuralCompleteness: 'incomplete',
        blockCount: extraction.blocks.length,
        extractedBlocksSha256: sha256(canonicalJson(extraction.blocks)),
        normalization: null,
        normalizationErrorCode: error.code,
      },
      extractionMs,
      normalizationMs,
    };
  }
  const normalizationMs = performance.now() - normalizationStarted;
  const normalization = summarizeNormalized(normalized);
  const omittedBlocks = extraction.blocks.length - normalized.blocks.length;
  const structuralIssues = [];
  const structure = extraction.diagnostics.structuralCounts;
  if (omittedBlocks < 0 || omittedBlocks > structure.revokedPlaceholders) {
    structuralIssues.push('NORMALIZER_BLOCK_COUNT_MISMATCH');
  }
  const omittedArticles = structure.articles - normalization.structuralCounts.article;
  if (omittedArticles < 0 || omittedArticles > structure.revokedPlaceholders) {
    structuralIssues.push('NORMALIZER_ARTICLE_COUNT_MISMATCH');
  }
  if (normalization.explicitParagraphs !== structure.paragraphs ||
      normalization.structuralCounts.inciso !== structure.incisos ||
      normalization.structuralCounts.alinea !== structure.alineas) {
    structuralIssues.push('NORMALIZER_SUBORDINATE_MARKER_COUNT_MISMATCH');
  }
  if ((structure.annexes > 0) !== (normalization.annexBlocks > 0)) {
    structuralIssues.push('NORMALIZER_ANNEX_MISMATCH');
  }
  if (normalization.duplicateArticleLocators > 0) {
    structuralIssues.push('DUPLICATE_ARTICLE_LOCATORS');
  }
  if (normalization.verifiedUtf16Offsets !== normalized.blocks.length) {
    structuralIssues.push('NORMALIZED_OFFSET_MISMATCH');
  }
  const complete = structuralIssues.length === 0;
  return {
    summary: {
      classification: complete
        ? 'DOU_CANDIDATE_EXTRACTION_PASS_UNREVIEWED' : 'DOU_CANDIDATE_STRUCTURAL_INCOMPLETE',
      ...extraction.diagnostics,
      structuralCompleteness: complete ? 'complete-under-candidate-contract' : 'incomplete',
      blockCount: extraction.blocks.length,
      extractedBlocksSha256: sha256(canonicalJson(extraction.blocks)),
      normalization,
      omittedBlocks,
      structuralIssues,
    },
    extractionMs,
    normalizationMs,
    normalized,
  };
}

function summarizeIdentities(
  normalized: NormalizedLegalDocument, fetched: FetchedDocument, source: SourceManifestEntry,
) {
  const versionId = documentVersionId(fetched.documentId, fetched.contentSha256);
  const space = 'chunks_h9c_c2_offline';
  const candidateSource = { ...source, extractor: DOU_EXTRACTOR_CANDIDATE } as const;
  return [STRUCTURAL_PROXY_CONFIG, RECURSIVE_PROXY_CONFIG].map(config => {
    try {
      const set = makeOfflineChunkSet(normalized, fetched, candidateSource, config);
      const metadata = set.chunks.map((chunk) => ({
        id: chunk.id, ordinal: chunk.ordinal, charStart: chunk.charStart, charEnd: chunk.charEnd,
        articleLocator: chunk.articleLocator, legalUnitIds: chunk.legalUnitIds,
      }));
      const verifiedOffsetCount = set.chunks.filter(chunk =>
        chunk.charStart >= 0 && chunk.charEnd <= normalized.normalizedText.length &&
        scalarBoundary(normalized.normalizedText, chunk.charStart) &&
        scalarBoundary(normalized.normalizedText, chunk.charEnd) &&
        normalized.normalizedText.slice(chunk.charStart, chunk.charEnd) === chunk.body).length;
      return {
        strategy: set.strategy,
        tokenizer: set.tokenizer,
        documentVersionId: set.versionId,
        pipelineProfileId: set.profileId,
        baseChunkSetId: set.baseChunkSetId,
        renderedChunkSetId: set.chunkSetId,
        normalizedSha256: set.normalizedSha256,
        headerMetadataSha256: set.headerMetadataSha256,
        v1IdempotencyKey: ingestionIdempotencyKey(fetched.documentId, fetched.contentSha256,
          set.profileId, space),
        v2IdempotencyKey: renderedIngestionIdempotencyKey(fetched.documentId, set.chunkSetId, space),
        chunkCount: set.chunks.length,
        chunksWithArticleLocator: metadata.filter(chunk => chunk.articleLocator !== null).length,
        chunksWithLegalUnitIds: metadata.filter(chunk => chunk.legalUnitIds.length > 0).length,
        chunkMetadataSha256: sha256(canonicalJson(metadata)),
        verifiedOffsetCount,
        identityVerified: set.versionId === versionId &&
          set.baseChunkSetId === chunkSetId(versionId, set.profileId) &&
          set.chunkSetId === renderAwareChunkSetId(set.baseChunkSetId, normalized.normalizedSha256,
            set.headerMetadataSha256) &&
          set.chunks.every((chunk, ordinal) => chunk.ordinal === ordinal &&
            chunk.id === chunkId(set.chunkSetId, ordinal)),
      };
    } catch (error) {
      if (!(error instanceof RagProcessingError)) throw error;
      return { strategy: config.strategy, errorCode: error.code };
    }
  });
}

function evaluate(
  directory: string, source: SourceManifestEntry, rawSha256: string, receiptSha256: string,
  repetitions: number,
) {
  const { fetched, decoded, decodedSha256, receipt } = readSelectedPair(
    directory, source, rawSha256, receiptSha256,
  );
  const legacy = assessH9CQuarantinedResponse(fetched, source);
  const legacyMatchesReceipt = legacy.extractionStatus === receipt.extractionStatus &&
    legacy.extractionErrorCode === receipt.extractionErrorCode &&
    legacy.decodedSha256 === receipt.decodedSha256 &&
    legacy.normalizedSha256 === receipt.normalizedSha256 &&
    legacy.normalizedBlocks === receipt.blocks;

  const warmup = candidateIteration(decoded, source);
  const resultSha256 = sha256(canonicalJson(warmup.summary));
  let repeatabilityVerified = true;
  const measurements = [];
  for (let i = 0; i < repetitions; i++) {
    const before = process.memoryUsage();
    const cpuStarted = process.cpuUsage();
    const trial = candidateIteration(decoded, source);
    const cpu = process.cpuUsage(cpuStarted);
    const after = process.memoryUsage();
    if (sha256(canonicalJson(trial.summary)) !== resultSha256) repeatabilityVerified = false;
    measurements.push({
      extractionMs: trial.extractionMs,
      normalizationMs: trial.normalizationMs,
      userCpuMicroseconds: cpu.user,
      systemCpuMicroseconds: cpu.system,
      rssBeforeBytes: before.rss,
      rssAfterBytes: after.rss,
      heapUsedBeforeBytes: before.heapUsed,
      heapUsedAfterBytes: after.heapUsed,
      cumulativeMaxRssKiB: process.resourceUsage().maxRSS,
    });
  }
  if (sha256(fetched.bytes) !== rawSha256) invalidEvidence();
  return {
    gate: 'H9C_C2_OFFLINE_DOU_EVALUATION',
    sourceId: source.sourceId,
    rawSha256,
    receiptSha256,
    byteSize: fetched.byteSize,
    receiptIntegrityVerified: true,
    decodedSha256,
    decodedUtf16: decoded.length,
    charset: fetched.charset,
    documentId: fetched.documentId,
    documentVersionId: documentVersionId(fetched.documentId, fetched.contentSha256),
    legacy: { extractor: source.extractor, ...legacy, agreesWithReceipt: legacyMatchesReceipt },
    extractor: DOU_EXTRACTOR_CANDIDATE,
    candidate: warmup.summary,
    byteProxyIdentities: warmup.normalized ? summarizeIdentities(warmup.normalized, fetched, source) : [],
    limitations: [
      'EXTERNAL_CSS_AND_RUNTIME_VISIBILITY_UNVERIFIED',
      'PENDING_HUMAN_LEGAL_VALIDATION',
    ],
    repeatability: { repetitions, warmupRuns: 1, resultSha256, verified: repeatabilityVerified },
    resources: {
      node: process.version, platform: process.platform, arch: process.arch,
      scope: 'candidate-extraction-normalization-and-aggregate-checks',
      measurements,
    },
    ...APPROVAL_FLAGS,
  };
}

// Offline-only. No source data, arbitrary error messages or paths leave this CLI.
const [directory, sourceId, rawSha256, receiptSha256, repetitionArgument] = process.argv.slice(2);
const source = SOURCE_MANIFEST.find(item => item.sourceId === sourceId && item.extractor === 'dou-html@1');
const repetitions = repetitionArgument === undefined ? 10 : Number(repetitionArgument);
if (process.argv.length < 6 || process.argv.length > 7 || !directory || !source ||
    !SHA256.test(rawSha256) || !SHA256.test(receiptSha256) ||
    !Number.isInteger(repetitions) || repetitions < 2 || repetitions > 25 ||
    (repetitionArgument !== undefined && repetitionArgument !== String(repetitions))) {
  process.stderr.write('H9C_C2_USAGE_INVALID\n');
  process.exitCode = 2;
} else {
  try {
    const result = evaluate(directory, source, rawSha256, receiptSha256, repetitions);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch {
    process.stderr.write('H9C_C2_EVALUATION_FAILED\n');
    process.exitCode = 1;
  }
}
