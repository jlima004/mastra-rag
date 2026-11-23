import { RAG_LIMITS } from '../contracts/types.ts';
import type { OfflineChunk } from './chunk.ts';
import { RagProcessingError } from './errors.ts';

export const H9_ENCODING = 'cl100k_base' as const;
export const H9_TOKEN_GRID = Object.freeze([256, 512, 1024] as const);
export const H9_MAX_AUDIT_INPUT_CHARS = 32_768;

const CHUNK_ID = /^[0-9a-f]{64}$/;
const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/**
 * The caller injects a candidate counter: this boundary cannot attest that
 * the implementation is a genuine, pinned cl100k_base tokenizer. No tokenizer
 * package, network or paid provider is accessed by this module.
 */
export type H9InjectedTokenCounter = Readonly<{
  encoding: typeof H9_ENCODING;
  countTokens: (fullEmbeddingInput: string) => number;
}>;

export type H9CalibrationInput = Pick<OfflineChunk, 'id' | 'content'>;

export type H9Distribution = Readonly<{
  total: number;
  p50: number;
  p95: number;
  max: number;
}>;

export type H9OfflineAudit = Readonly<{
  evidenceClass: 'synthetic-fixture-only';
  counterTrust: 'injected-unverified';
  liveAdmissionApproved: false;
  encodingClaim: typeof H9_ENCODING;
  sampleCount: number;
  observedTokens: H9Distribution;
  bytePlusEightProxy: H9Distribution;
  exceedsTokenGrid: Readonly<{
    over256: number;
    over512: number;
    over1024: number;
  }>;
  exceedsProviderInputCap8191: number;
  exceedsJobCap: boolean;
  byteProxyUndercountSamples: number;
  maxByteProxyUndercountTokens: number;
}>;

function invalid(): never {
  throw new RagProcessingError('INVALID_DOCUMENT');
}

function distribution(values: readonly number[]): H9Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isSafeInteger(sum)) invalid();
  return Object.freeze({
    total: sum,
    p50: sorted[Math.ceil(sorted.length * 0.50) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted[sorted.length - 1],
  });
}

/**
 * OFFLINE H9 preparation only. Audits the exact chunk.content passed to
 * embedding (including the context header), rather than the body or the
 * normalized source alone. Thresholds describe CURRENT byte-proxy chunks:
 * they do not simulate a 256/512/1024-token re-chunking grid.
 *
 * The injected counter is deliberately marked unverified, even if it claims
 * cl100k_base. Real H9 approval requires an independently reviewed, pinned
 * tokenizer and official-source snapshot, a new versioned chunking profile,
 * and cross-checking against provider usage in a separately approved smoke.
 */
export function auditH9OfflineTokenCounts(
  chunks: readonly H9CalibrationInput[],
  counter: H9InjectedTokenCounter,
): H9OfflineAudit {
  if (!Array.isArray(chunks) || chunks.length === 0 ||
      chunks.length > RAG_LIMITS.MAX_CHUNKS_PER_VERSION ||
      !counter || counter.encoding !== H9_ENCODING ||
      typeof counter.countTokens !== 'function') invalid();

  const seen = new Set<string>();
  const measured: number[] = [];
  const proxy: number[] = [];
  let over256 = 0;
  let over512 = 0;
  let over1024 = 0;
  let over8191 = 0;
  let proxyUndercount = 0;
  let maxUndercount = 0;

  for (const chunk of chunks) {
    if (!chunk || typeof chunk.id !== 'string' || !CHUNK_ID.test(chunk.id) ||
        seen.has(chunk.id) || typeof chunk.content !== 'string' ||
        chunk.content.length === 0 ||
        chunk.content.length > H9_MAX_AUDIT_INPUT_CHARS ||
        !chunk.content.trim() || UNPAIRED_SURROGATE.test(chunk.content)) invalid();

    seen.add(chunk.id);
    const input = chunk.content;
    let tokens: number;
    try {
      tokens = counter.countTokens(input);
    } catch {
      // Counter failures must not leak a raw exception or embedding input.
      return invalid();
    }
    if (!Number.isSafeInteger(tokens) || tokens < 1 ||
        tokens > RAG_LIMITS.MAX_TOKENS_PER_JOB) invalid();
    const bytesPlusEight = Buffer.byteLength(input, 'utf8') + 8;
    if (!Number.isSafeInteger(bytesPlusEight)) invalid();

    measured.push(tokens);
    proxy.push(bytesPlusEight);
    if (tokens > 256) over256++;
    if (tokens > 512) over512++;
    if (tokens > RAG_LIMITS.HARD_MAX_CHUNK_TOKENS) over1024++;
    if (tokens > 8191) over8191++;
    if (tokens > bytesPlusEight) {
      proxyUndercount++;
      maxUndercount = Math.max(maxUndercount, tokens - bytesPlusEight);
    }
  }

  const observedTokens = distribution(measured);
  return Object.freeze({
    evidenceClass: 'synthetic-fixture-only',
    counterTrust: 'injected-unverified',
    liveAdmissionApproved: false,
    encodingClaim: H9_ENCODING,
    sampleCount: chunks.length,
    observedTokens,
    bytePlusEightProxy: distribution(proxy),
    exceedsTokenGrid: Object.freeze({ over256, over512, over1024 }),
    exceedsProviderInputCap8191: over8191,
    exceedsJobCap: observedTokens.total > RAG_LIMITS.MAX_TOKENS_PER_JOB,
    byteProxyUndercountSamples: proxyUndercount,
    maxByteProxyUndercountTokens: maxUndercount,
  });
}
