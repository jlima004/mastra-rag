import { performance } from 'node:perf_hooks';
import {
  canonicalJson, chunkId, chunkSetId, documentVersionId,
  ingestionIdempotencyKey, renderedIngestionIdempotencyKey, sha256,
} from '../src/mastra/rag/contracts/ids.ts';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import type {
  FetchedDocument, SourceManifestEntry,
} from '../src/mastra/rag/contracts/types.ts';
import {
  makeOfflineChunkSet, RECURSIVE_PROXY_CONFIG, renderAwareChunkSetId, STRUCTURAL_PROXY_CONFIG,
} from '../src/mastra/rag/processing/chunk.ts';
import { DOU_EXTRACTOR_CANDIDATE } from '../src/mastra/rag/processing/dou-html.ts';
import { evaluateDouCandidate, readSelectedDouPair, scalarBoundary } from '../src/mastra/rag/processing/dou-evaluation.ts';
import { RagProcessingError } from '../src/mastra/rag/processing/errors.ts';
import type { NormalizedLegalDocument } from '../src/mastra/rag/processing/legal.ts';
import { assessH9CQuarantinedResponse } from '../src/mastra/rag/processing/source-quarantine.ts';

const SHA256 = /^[a-f0-9]{64}$/;
const APPROVAL_FLAGS = Object.freeze({
  officialLegalTextAccepted: false,
  snapshotSemanticallyReviewed: false,
  paidAdmissionApproved: false,
} as const);

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
  const { fetched, decoded, decodedSha256, receipt } = readSelectedDouPair(
    directory, source, rawSha256, receiptSha256,
  );
  const legacy = assessH9CQuarantinedResponse(fetched, source);
  const legacyMatchesReceipt = legacy.extractionStatus === receipt.extractionStatus &&
    legacy.extractionErrorCode === receipt.extractionErrorCode &&
    legacy.decodedSha256 === receipt.decodedSha256 &&
    legacy.normalizedSha256 === receipt.normalizedSha256 &&
    legacy.normalizedBlocks === receipt.blocks;

  const warmup = evaluateDouCandidate(decoded, source);
  const resultSha256 = sha256(canonicalJson(warmup.summary));
  let repeatabilityVerified = true;
  const measurements = [];
  for (let i = 0; i < repetitions; i++) {
    const before = process.memoryUsage();
    const cpuStarted = process.cpuUsage();
    const trial = evaluateDouCandidate(decoded, source);
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
  if (sha256(fetched.bytes) !== rawSha256) throw new Error('H9C_C2_INVALID_EVIDENCE');
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
