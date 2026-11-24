import { sha256 } from '../contracts/ids.ts';
import type { FetchedDocument, SourceManifestEntry } from '../contracts/types.ts';
import { decodeFetchedDocument } from './decode.ts';
import { RagProcessingError } from './errors.ts';
import { extractHtmlBlocks, extractTextBlocks } from './html.ts';
import { normalizeLegalBlocks } from './legal.ts';

/**
 * A verified HTTPS 200 response is only a candidate source. Even if extraction
 * fails, the acquisition may be quarantined; this never proves the body is an
 * official legal act, instead of an interstitial/challenge/error page.
 */
export type H9CQuarantineAssessment = Readonly<{
  extractionStatus: 'unreviewed-parsed' | 'unsupported';
  extractionErrorCode: string | null;
  decodedSha256: string | null;
  normalizedSha256: string | null;
  normalizedBlocks: number | null;
  officialLegalTextAccepted: false;
  snapshotSemanticallyReviewed: false;
  paidAdmissionApproved: false;
}>;

export function assessH9CQuarantinedResponse(
  fetched: FetchedDocument,
  source: SourceManifestEntry,
): H9CQuarantineAssessment {
  let decodedSha256: string | null = null;
  try {
    const decoded = decodeFetchedDocument(fetched, source);
    decodedSha256 = sha256(decoded);
    const rawBlocks = fetched.sniffedMediaType === 'text/html'
      ? extractHtmlBlocks(decoded)
      : extractTextBlocks(decoded, fetched.sniffedMediaType);
    const normalized = normalizeLegalBlocks(rawBlocks, source);
    return Object.freeze({
      extractionStatus: 'unreviewed-parsed',
      extractionErrorCode: null,
      decodedSha256,
      normalizedSha256: normalized.normalizedSha256,
      normalizedBlocks: normalized.blocks.length,
      officialLegalTextAccepted: false,
      snapshotSemanticallyReviewed: false,
      paidAdmissionApproved: false,
    });
  } catch (error) {
    // Fixed diagnostic code only. Do NOT forward exceptions, URLs or HTML.
    return Object.freeze({
      extractionStatus: 'unsupported',
      extractionErrorCode: error instanceof RagProcessingError
        ? error.code : 'H9C_ASSESSMENT_FAILED',
      decodedSha256,
      normalizedSha256: null,
      normalizedBlocks: null,
      officialLegalTextAccepted: false,
      snapshotSemanticallyReviewed: false,
      paidAdmissionApproved: false,
    });
  }
}
