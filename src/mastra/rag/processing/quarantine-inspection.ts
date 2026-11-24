import { sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { RAG_LIMITS } from '../contracts/types.ts';
import { validateCanonicalSourceUrl } from '../contracts/validation.ts';

/**
 * Classify locally quarantined operator evidence only. Never certify current
 * legal wording, authenticity of a DOU act, or admission to a paid provider.
 * No source text, URL, page title, filesystem path or HTTP headers are emitted.
 */
export type H9CQuarantineInspection = Readonly<{
  sourceId: string;
  evidenceClass: 'private-raw-quarantine-only';
  rawSha256: string;
  byteSize: number;
  receiptIntegrityVerified: true;
  extractionStatus: 'unsupported' | 'unreviewed-parsed';
  extractorCode: string | null;
  diagnosticFlags: Readonly<{
    htmlTagObserved: boolean;
    titleTagObserved: boolean;
    legalArticleMarkerObserved: boolean;
    legalResolutionMarkerObserved: boolean;
    possibleAccessChallengeObserved: boolean;
    metaCharsetDeclared: boolean;
  }>;
  documentClassification: 'unreviewed-requires-human-inspection';
  officialLegalTextAccepted: false;
  snapshotSemanticallyReviewed: false;
  paidAdmissionApproved: false;
}>;

export type H9CQuarantineReceipt = Readonly<{
  evidenceClass: string;
  sourceId: string;
  canonicalUri: string;
  finalUri: string;
  status: number;
  mediaType: string;
  charset: string;
  byteSize: number;
  rawSha256: string;
  extractionStatus: string;
  extractionErrorCode: string | null;
  evidenceFileBasename: string;
  officialLegalTextAccepted: boolean;
  snapshotSemanticallyReviewed: boolean;
  paidAdmissionApproved: boolean;
}>;

function invalid(): never {
  throw new Error('H9C_INSPECTION_INVALID_EVIDENCE');
}

export function inspectH9CQuarantinedEvidence(
  raw: Uint8Array,
  receipt: H9CQuarantineReceipt,
): H9CQuarantineInspection {
  if (!(raw instanceof Uint8Array) || !receipt || typeof receipt !== 'object' ||
      !Number.isSafeInteger(raw.byteLength) || raw.byteLength === 0 ||
      raw.byteLength > RAG_LIMITS.MAX_RAW_BYTES ||
      receipt.evidenceClass !== 'operator-readonly-acquisition-quarantined' ||
      receipt.status !== 200 || receipt.mediaType !== 'text/html' ||
      typeof receipt.sourceId !== 'string' ||
      typeof receipt.canonicalUri !== 'string' ||
      typeof receipt.finalUri !== 'string' ||
      typeof receipt.charset !== 'string' ||
      !['utf-8', 'windows-1252', 'iso-8859-1'].includes(receipt.charset.toLowerCase()) ||
      !['unsupported', 'unreviewed-parsed'].includes(receipt.extractionStatus) ||
      receipt.officialLegalTextAccepted !== false ||
      receipt.snapshotSemanticallyReviewed !== false ||
      receipt.paidAdmissionApproved !== false ||
      receipt.byteSize !== raw.byteLength ||
      typeof receipt.rawSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receipt.rawSha256) ||
      sha256(raw) !== receipt.rawSha256 ||
      receipt.evidenceFileBasename !== receipt.sourceId + '-' +
        receipt.rawSha256 + '.source.html' ||
      (receipt.extractionStatus === 'unsupported' &&
        typeof receipt.extractionErrorCode !== 'string') ||
      (receipt.extractionStatus === 'unreviewed-parsed' &&
        receipt.extractionErrorCode !== null)) invalid();

  const source = SOURCE_MANIFEST.find(s => s.sourceId === receipt.sourceId);
  if (!source || source.canonicalUri !== receipt.canonicalUri) invalid();
  try {
    if (validateCanonicalSourceUrl(receipt.finalUri) !== receipt.finalUri) invalid();
  } catch {
    invalid();
  }

  let decoded: string;
  try {
    decoded = new TextDecoder(receipt.charset.toLowerCase(), { fatal: false }).decode(raw);
  } catch {
    invalid();
  }
  // These are weak diagnostic hints for an operator, not a trusted extractor.
  // A page can have all of them and still be an access interstitial.
  const normalized = decoded.normalize('NFD').replace(/\p{M}/gu, '');
  const flags = Object.freeze({
    htmlTagObserved: /<(?:!doctype\s+html|html\b|body\b|p\b|div\b)/i.test(decoded),
    titleTagObserved: /<title[\s>]/i.test(decoded),
    legalArticleMarkerObserved: /\bart\.?\s*\d{1,4}\s*[ºo°.]?/i.test(normalized),
    legalResolutionMarkerObserved: /\bresolucao\s+(?:cd\s*\/\s*anpd|n[ºo.]?)\b/i.test(normalized),
    possibleAccessChallengeObserved:
      /captcha|recaptcha|cloudflare|access\s+denied|acesso\s+negado|cf_chl|challenge-platform|robot\s+check|verification\s+required/i.test(normalized),
    metaCharsetDeclared: /<meta\b[^>]{0,400}charset\s*=/i.test(decoded),
  });
  return Object.freeze({
    sourceId: receipt.sourceId,
    evidenceClass: 'private-raw-quarantine-only',
    rawSha256: receipt.rawSha256,
    byteSize: raw.byteLength,
    receiptIntegrityVerified: true,
    extractionStatus: receipt.extractionStatus as 'unsupported' | 'unreviewed-parsed',
    extractorCode: receipt.extractionErrorCode,
    diagnosticFlags: flags,
    documentClassification: 'unreviewed-requires-human-inspection',
    officialLegalTextAccepted: false,
    snapshotSemanticallyReviewed: false,
    paidAdmissionApproved: false,
  });
}
