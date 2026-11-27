import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalJson, documentId, sha256 } from '../contracts/ids.ts';
import { RAG_LIMITS, type FetchedDocument, type SourceManifestEntry } from '../contracts/types.ts';
import { decodeFetchedDocument } from './decode.ts';
import { DouHtmlCandidateError, extractDouHtmlCandidate } from './dou-html.ts';
import { normalizeDouLegalBlocks } from './dou-legal.ts';
import { RagProcessingError } from './errors.ts';
import type { NormalizedLegalDocument } from './legal.ts';
import { openH9CPrivateArchiveDirectory } from './private-archive.ts';
import { inspectH9CQuarantinedEvidence, type H9CQuarantineReceipt } from './quarantine-inspection.ts';

const SHA256 = /^[a-f0-9]{64}$/;
const LOCATOR_METADATA_DIGEST = 'h9c-c2-locator-metadata:v1';

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

export function readSelectedDouPair(
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

export function scalarBoundary(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  return !(unit >= 0xdc00 && unit <= 0xdfff);
}

function summarizeNormalized(doc: NormalizedLegalDocument) {
  const structuralCounts = { heading: 0, article: 0, paragraph: 0, inciso: 0, alinea: 0, preamble: 0 };
  const explicitUnitLocators = new Set<string>();
  const headingDigests = new Map<string, string>();
  const metadataHasher = createHash('sha256').update(LOCATOR_METADATA_DIGEST + '\n');
  let explicitParagraphs = 0;
  let duplicateArticleLocators = 0;
  let duplicateExplicitSubordinateLocators = 0;
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
    const explicitParagraph = block.kind === 'paragraph' &&
      /^(?:§\s*\d|Par[aá]grafo\s+[uú]nico\b)/iu.test(block.text);
    if (explicitParagraph) explicitParagraphs++;
    if (block.headingPath.length) blocksWithHeadingContext++;
    annotations += block.annotations.length;
    const inAnnex = /:anexo[1-9][0-9]*:/.test(block.locator);
    if (inAnnex) {
      annexBlocks++;
      if (annexStart < 0) annexStart = block.start;
      annexEnd = block.end;
      if (block.kind === 'article') annexArticles++;
    }
    if (block.kind === 'article' || explicitParagraph ||
        block.kind === 'inciso' || block.kind === 'alinea') {
      if (explicitUnitLocators.has(block.locator)) {
        if (block.kind === 'article') duplicateArticleLocators++;
        else duplicateExplicitSubordinateLocators++;
      }
      explicitUnitLocators.add(block.locator);
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
    duplicateExplicitSubordinateLocators,
    uniqueExplicitLegalUnitLocators: explicitUnitLocators.size,
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

export function evaluateDouCandidate(decoded: string, source: SourceManifestEntry) {
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
  if (normalization.duplicateExplicitSubordinateLocators > 0) {
    structuralIssues.push('DUPLICATE_EXPLICIT_SUBORDINATE_LOCATORS');
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
