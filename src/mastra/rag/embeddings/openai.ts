import { countH9Cl100kTokens } from '../processing/cl100k-counter.ts';
import { RagEmbeddingError } from './errors.ts';
import { requireEmbeddingUsage, validateEmbeddingVectors, type EmbeddingProvider } from './provider.ts';
import { requireEmbeddingSpace } from './space.ts';

const SPACE = requireEmbeddingSpace('chunks_te3s_1536_v1');
export const OPENAI_EMBEDDING_CONFIG = Object.freeze({
  endpoint: 'https://api.openai.com/v1/embeddings',
  provider: 'openai',
  model: SPACE.embeddingModel,
  dimension: SPACE.dimension,
  spaceId: SPACE.spaceId,
  maxInputsPerCall: 128,
  maxInputTokens: 512,
});
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const TIMEOUT_MS = 25_000;
const NON_RETRYABLE_QUOTA = new Set([
  'insufficient_quota', 'organization_usage_limit_exceeded', 'credit_balance_exhausted',
  'organization_spend_limit_exceeded', 'project_spend_limit_exceeded',
]);

function credential(): string | undefined {
  const value = process.env.OPENAI_API_KEY;
  return value && /^[!-~]+$/.test(value) ? value : undefined;
}

export function assertDirectOpenAITransport(): void {
  // Node may install an ambient fetch proxy before any application code runs.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      process.env.NODE_USE_ENV_PROXY === '1' ||
      [...process.execArgv, process.env.NODE_OPTIONS ?? ''].some(value => value.includes('--use-env-proxy'))) {
    throw new RagEmbeddingError('EMBED_TRANSPORT_CONFIG_INVALID');
  }
}

export function hasOpenAIEmbeddingCredential(): boolean {
  return credential() !== undefined;
}

export function parseRetryAfter(raw: string | null, nowMs = Date.now()): number | null {
  if (raw === null || typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{1,10}$/.test(value)) {
    const seconds = Number(value);
    const ms = seconds * 1000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  // Only RFC 1123 GMT dates are accepted. Date.parse('-1') and similar
  // ambiguous strings can otherwise parse as historical dates and return 0.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    return null;
  }
  const target = Date.parse(value);
  if (!Number.isFinite(target) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.ceil(target - nowMs));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

async function readJSON(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    if (Number(response.headers.get('content-length')) > limit) {
      throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
    }
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > limit) throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function httpFailure(response: Response, signal: AbortSignal): Promise<RagEmbeddingError> {
  const { status } = response;
  if (status === 429) {
    // Inspect only the bounded error code. Never propagate the upstream body.
    const body = object(await readJSON(response, MAX_ERROR_BYTES, signal).catch(() => null));
    const error = object(body?.error);
    if ([error?.code, error?.type].some(value => typeof value === 'string' && NON_RETRYABLE_QUOTA.has(value))) {
      return new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
    }
  } else if (response.body) {
    void response.body.cancel().catch(() => {});
  }
  if (signal.aborted) return new RagEmbeddingError('EMBED_ABORTED');
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
    const retryAfterMs = status === 429 || status === 503
      ? parseRetryAfter(response.headers.get('retry-after')) : null;
    return new RagEmbeddingError('EMBED_PROVIDER_TRANSIENT', {
      retryable: true,
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    });
  }
  return new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
}

function validateResponse(raw: unknown, count: number, signal: AbortSignal) {
  const envelope = object(raw);
  const usage = object(envelope?.usage);
  const tokens = requireEmbeddingUsage({ tokens: usage?.prompt_tokens });
  if (tokens < 1 || usage?.total_tokens !== tokens) throw new RagEmbeddingError('EMBED_USAGE_INVALID');
  try {
    if (signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
    if (envelope?.object !== 'list' || envelope.model !== SPACE.embeddingModel ||
        !Array.isArray(envelope.data) || envelope.data.length !== count) {
      throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
    }
    const byIndex = new Map<number, unknown>();
    for (const value of envelope.data) {
      const item = object(value);
      const index = item?.index;
      if (item?.object !== 'embedding' || typeof index !== 'number' || !Number.isInteger(index) ||
          index < 0 || index >= count || byIndex.has(index)) {
        throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
      }
      byIndex.set(index, item.embedding);
    }
    const vectors = validateEmbeddingVectors(
      Array.from({ length: count }, (_, index) => byIndex.get(index)), count, SPACE.dimension,
    );
    if (vectors.some(vector => vector.some(value => !Number.isFinite(Math.fround(value))))) {
      throw new RagEmbeddingError('EMBED_NONFINITE_VECTOR');
    }
    return { vectors, usage: { tokens } };
  } catch (error) {
    const code = error instanceof RagEmbeddingError ? error.code : 'EMBED_PROVIDER_FAILURE';
    throw new RagEmbeddingError(code, { reportedTokens: tokens });
  }
}

export function createOpenAIEmbeddingProvider(
  { allowPaidCalls = false }: Readonly<{ allowPaidCalls?: boolean }> = {},
): EmbeddingProvider {
  const { endpoint, model, dimension, spaceId, maxInputsPerCall, maxInputTokens } = OPENAI_EMBEDDING_CONFIG;
  return Object.freeze({
    spaceId, dimension, maxInputsPerCall, maxInputTokens,
    async embed(inputs, options) {
      if (allowPaidCalls !== true) throw new RagEmbeddingError('EMBED_PAID_NOT_AUTHORIZED');
      if (!options || !(options.signal instanceof AbortSignal) ||
          (options.purpose !== 'document' && options.purpose !== 'query') ||
          !Array.isArray(inputs) || inputs.length < 1 || inputs.length > maxInputsPerCall ||
          Array.from(inputs).some(value => typeof value !== 'string' || !value.trim() ||
            value.includes('\0'))) {
        throw new RagEmbeddingError('EMBED_INVALID_INPUT');
      }
      if (options.signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
      assertDirectOpenAITransport();
      const key = credential();
      if (!key) throw new RagEmbeddingError('EMBED_CREDENTIAL_UNAVAILABLE');
      const exactInputs = [...inputs];
      try {
        if (exactInputs.some(value => countH9Cl100kTokens(value) > maxInputTokens)) {
          throw new RagEmbeddingError('EMBED_INVALID_INPUT');
        }
      } catch {
        throw new RagEmbeddingError('EMBED_INVALID_INPUT');
      }
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      const bytes = new TextEncoder().encode(JSON.stringify({
        model, input: exactInputs, dimensions: dimension, encoding_format: 'float',
      }));
      // Node's fetch can replay a buffered request on HTTP 421. A one-shot
      // stream has no replayable body source in the bundled Undici.
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); controller.close(); },
      });
      const request: RequestInit & { duplex: 'half' } = {
        method: 'POST', redirect: 'error', signal, body, duplex: 'half',
        headers: {
          Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          'Content-Length': String(bytes.byteLength),
        },
      };
      let raw: unknown;
      try {
        const response = await fetch(endpoint, request);
        if (!response.ok) throw await httpFailure(response, signal);
        raw = await readJSON(response, MAX_RESPONSE_BYTES, signal);
      } catch (error) {
        if (error instanceof RagEmbeddingError) throw error;
        throw new RagEmbeddingError(signal.aborted ? 'EMBED_ABORTED' : 'EMBED_PROVIDER_FAILURE');
      }
      return validateResponse(raw, exactInputs.length, signal);
    },
  } satisfies EmbeddingProvider);
}
