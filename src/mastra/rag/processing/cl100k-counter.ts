import { Tiktoken } from 'js-tiktoken/lite';
import cl100kBaseRanks from 'js-tiktoken/ranks/cl100k_base';
import { RagProcessingError } from './errors.ts';
import {
  auditH9OfflineTokenCounts,
  H9_ENCODING,
  H9_MAX_AUDIT_INPUT_CHARS,
  type H9CalibrationInput,
  type H9InjectedTokenCounter,
  type H9OfflineAudit,
} from './token-calibration.ts';

/** Dependency is pinned exactly in package.json and package-lock.json. */
export const H9_PINNED_TOKENIZER = Object.freeze({
  packageName: 'js-tiktoken',
  version: '1.0.21',
  encoding: H9_ENCODING,
  model: 'openai/text-embedding-3-small',
  evidenceClass: 'offline-synthetic-only',
  liveAdmissionApproved: false,
} as const);

const INVALID_UNICODE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
let tokenizer: Tiktoken | undefined;

function invalid(): never {
  throw new RagProcessingError('INVALID_DOCUMENT');
}

/**
 * Lazy in-process initialization. The import is a local bundled rank table:
 * it must not download tokenizer data or contact a remote provider.
 */
function getTokenizer(): Tiktoken {
  if (!tokenizer) {
    try {
      tokenizer = new Tiktoken(cl100kBaseRanks);
    } catch {
      invalid();
    }
  }
  return tokenizer;
}

/**
 * Counts cl100k_base tokens in the EXACT embedding input, including headers.
 * This is deterministic offline vocabulary tokenization, NOT a proof of
 * provider-billed usage, production admission, or H9 source validation.
 */
export function countH9Cl100kTokens(text: string): number {
  if (typeof text !== 'string' || !text.trim() ||
      text.length > H9_MAX_AUDIT_INPUT_CHARS ||
      INVALID_UNICODE.test(text)) invalid();
  try {
    const count = getTokenizer().encode(text).length;
    if (!Number.isSafeInteger(count) || count < 1) invalid();
    return count;
  } catch {
    // Third-party errors may contain the input; never expose raw causes.
    return invalid();
  }
}

/** Use only in the offline H9A diagnostic, not a paid runtime job. */
export const H9_PINNED_COUNTER: H9InjectedTokenCounter = Object.freeze({
  encoding: H9_ENCODING,
  countTokens: countH9Cl100kTokens,
});

/**
 * The audit contract intentionally stays fail-closed and marks the counter as
 * unverified. The audit cannot attest external source provenance or authorize
 * provider calls even though this adapter uses a pinned local implementation.
 */
export function auditH9PinnedSyntheticChunks(
  chunks: readonly H9CalibrationInput[],
): H9OfflineAudit {
  return auditH9OfflineTokenCounts(chunks, H9_PINNED_COUNTER);
}
