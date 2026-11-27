import { documentVersionId } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { evaluateDouCandidate, readSelectedDouPair } from './dou-evaluation.ts';
import { DOU_EXTRACTOR_CANDIDATE } from './dou-html.ts';

export type MvpSnapshotPin = Readonly<{
  sourceId: string;
  canonicalUri: string;
  title: string;
  rawSha256: string;
  receiptSha256: string;
  normalizedSha256: string;
  extractedBlocksSha256: string;
  locatorMetadataSha256: string;
  documentId: string;
  documentVersionId: string;
  fetchedAt: string;
  charset: 'utf-8';
  byteSize: number;
  blocks: number;
  explicitLocators: number;
  mainArticles: number;
  annexArticles: number;
}>;

/** Exact pair and structural evidence selected under Issue #35. Offline only. */
export const MVP_EXPERIMENTAL_CORPUS = Object.freeze({
  schemaVersion: 1,
  classification: 'MVP_EXPERIMENTAL_CORPUS_FROZEN',
  extractor: DOU_EXTRACTOR_CANDIDATE,
  normalizer: 'legal-text@1',
  normalizerImplementation: 'normalizeDouLegalBlocks',
  legalCertificationApproved: false,
  paidAdmissionApproved: false,
  productionActivationApproved: false,
  limitations: Object.freeze([
    'EXPERIMENTAL_REGULATORY_KNOWLEDGE_MVP',
    'PLANALTO_LGPD_DEFERRED',
    'LEGAL_CURRENCY_AND_INDEPENDENT_COTEJO_UNVERIFIED',
    'BROWSER_VISIBILITY_EQUIVALENCE_UNVERIFIED',
  ] as const),
  snapshots: Object.freeze([
    Object.freeze({
      sourceId: 'br-anpd-res-15-2024',
      canonicalUri: 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024',
      title: 'Resolução CD/ANPD nº 15/2024 — Comunicação de Incidente de Segurança',
      rawSha256: '06acf25cafdf7a235c5a2b2f9259a8238ec0d3e770de7a4f29321aa2e724370f',
      receiptSha256: '9f931731bcfdc98ef506d0e02ff5178b512016c1db4b076c90a88dd25efe486a',
      normalizedSha256: '7deead26686c1d78c6059bdea49aecde9cd21a6d5184a43073b165b1fff9acc5',
      extractedBlocksSha256: 'a85e0cdc81f6d621a7522995c4b751b82e9abc0bfd60d6decb983edd01febd0a',
      locatorMetadataSha256: 'd0383edfeb592478185a43dd579e40ff27c92988c5dc01eb283cc4d5d5ce6422',
      documentId: '31ca3962296e07010665bdf41077bad6e9a4dff579b320713a8a087e89c2f23b',
      documentVersionId: '3c404a458aa719897135334123cc423cca99e22d02066017c0fd8a7938c7055c',
      fetchedAt: '2026-11-25T21:01:10.246Z',
      charset: 'utf-8',
      byteSize: 114_363,
      blocks: 171,
      explicitLocators: 135,
      mainArticles: 3,
      annexArticles: 24,
    }),
    Object.freeze({
      sourceId: 'br-anpd-res-18-2024',
      canonicalUri: 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-18-de-16-de-julho-de-2024-572632074',
      title: 'Resolução CD/ANPD nº 18/2024 — Atuação do Encarregado',
      rawSha256: 'b5941ce0f4a7c06b3fd04b87ea01572871386012982c6b3a03be9a3549eaa111',
      receiptSha256: '4d6c2d3b71405d022df5777fe423c958f8d4f5c30836bb5fb6cdb15143d107ec',
      normalizedSha256: 'da56b95aefb77f3c4acc41d580d0c7cf114c290b74e13987a203ec72814f203b',
      extractedBlocksSha256: '573b0ab97fbc015b5e0b102720b62cd03a25c2d5bbf7a216595a8fa44d6ce44c',
      locatorMetadataSha256: 'f9e07349f747ab70781aa3cc9f9ddc7a9b0a4cebb1d116f33713631a91ed46a7',
      documentId: '79a1993904998f53c1c36f4503f190fcbbacee4131e4fe8825a2899a4787822b',
      documentVersionId: '2f5d0a8ab14facb39c2ea90c0805a765b3601f124a7d849f6a1b54e8dd37c38f',
      fetchedAt: '2026-11-25T21:01:10.894Z',
      charset: 'utf-8',
      byteSize: 100_459,
      blocks: 102,
      explicitLocators: 77,
      mainArticles: 2,
      annexArticles: 21,
    }),
  ] satisfies readonly MvpSnapshotPin[]),
} as const);

export type MvpAdmissionFailureCode =
  | 'MVP_SOURCE_MANIFEST_MISMATCH'
  | 'MVP_QUARANTINE_PAIR_INVALID'
  | 'MVP_SNAPSHOT_IDENTITY_MISMATCH'
  | 'MVP_C2_STRUCTURE_MISMATCH';

export class MvpAdmissionError extends Error {
  readonly code: MvpAdmissionFailureCode;

  constructor(code: MvpAdmissionFailureCode) {
    super(code);
    this.code = code;
  }
}

export function validateMvpSnapshot(directory: string, pin: MvpSnapshotPin) {
  const source = SOURCE_MANIFEST.find(entry => entry.sourceId === pin.sourceId);
  if (!MVP_EXPERIMENTAL_CORPUS.snapshots.some(entry => entry.sourceId === pin.sourceId) ||
      source?.extractor !== 'dou-html@1' || source.canonicalUri !== pin.canonicalUri) {
    throw new MvpAdmissionError('MVP_SOURCE_MANIFEST_MISMATCH');
  }
  const pair = (() => {
    try {
      return readSelectedDouPair(directory, source, pin.rawSha256, pin.receiptSha256);
    } catch {
      throw new MvpAdmissionError('MVP_QUARANTINE_PAIR_INVALID');
    }
  })();
  const { fetched, decoded } = pair;
  if (fetched.documentId !== pin.documentId || fetched.byteSize !== pin.byteSize ||
      fetched.charset !== pin.charset || fetched.fetchedAt !== pin.fetchedAt ||
      documentVersionId(fetched.documentId, fetched.contentSha256) !== pin.documentVersionId) {
    throw new MvpAdmissionError('MVP_SNAPSHOT_IDENTITY_MISMATCH');
  }

  const { summary, normalized, extractionMs, normalizationMs } = evaluateDouCandidate(decoded, source);
  const structure = summary.normalization;
  if (!normalized || !structure || summary.classification !== 'DOU_CANDIDATE_EXTRACTION_PASS_UNREVIEWED' ||
      summary.admissibleContainers !== 1 || summary.headerAssociation !== 'associated' ||
      summary.structuralCounts.actHeadings !== 1 || summary.structuralCounts.annexes !== 1 ||
      structure.normalizedSha256 !== pin.normalizedSha256 ||
      summary.extractedBlocksSha256 !== pin.extractedBlocksSha256 ||
      structure.locatorMetadataSha256 !== pin.locatorMetadataSha256 ||
      structure.blockCount !== pin.blocks || structure.verifiedUtf16Offsets !== pin.blocks ||
      structure.uniqueExplicitLegalUnitLocators !== pin.explicitLocators ||
      structure.annexArticles !== pin.annexArticles ||
      structure.structuralCounts.article - structure.annexArticles !== pin.mainArticles) {
    throw new MvpAdmissionError('MVP_C2_STRUCTURE_MISMATCH');
  }

  return {
    fetched,
    normalized,
    source: { ...source, title: pin.title, extractor: DOU_EXTRACTOR_CANDIDATE } as const,
    validation: {
      sourceId: source.sourceId,
      receiptIntegrityVerified: true,
      manifestIdentityVerified: true,
      matchesH9CC2Evidence: true,
      headerAssociation: summary.headerAssociation,
      structuralCounts: summary.structuralCounts,
      normalization: structure,
    },
    performance: { extractionMs, normalizationMs, cumulativeMaxRssKiB: process.resourceUsage().maxRSS },
  };
}
