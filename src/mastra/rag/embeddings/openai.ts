import type { EmbeddingProvider } from './provider.ts';
import { requireEmbeddingUsage, validateEmbeddingVectors } from './provider.ts';
import { RagEmbeddingError } from './errors.ts';
import { requireEmbeddingSpace } from './space.ts';

export const OPENAI_ROUTER_MODEL_ID = 'openai/text-embedding-3-small' as const;
const SPACE = requireEmbeddingSpace('chunks_te3s_1536_v1');
const MAX_INPUTS_PER_CALL = 128;
const MAX_INPUT_TOKENS = 8191;

/**
 * A small, injectable boundary around the @mastra/core@1.83.0 model router.
 * Native doEmbed is used directly: the ai / embedMany package is NOT added.
 * The type boundary intentionally accepts unknown response data for validation.
 */
export type RouterEmbeddingModel = Readonly<{
  doEmbed(args: {
    values: string[];
    abortSignal?: AbortSignal;
    providerOptions?: Record<string, Record<string, unknown>>;
  }): Promise<{ embeddings: unknown; usage?: unknown }>;
}>;

export type OpenAIRouterOptions = Readonly<{
  /** H11 MUST be ratified separately before this can be set true in production. */
  allowPaidCalls?: boolean;
  /** Offline-only dependency injection for regression tests; never uses keys. */
  modelFactory?: () => Promise<RouterEmbeddingModel> | RouterEmbeddingModel;
}>;

function safeStatus(error: unknown): number | null {
  try {
    if (!error || typeof error !== 'object') return null;
    const e = error as Record<string, unknown>;
    const status = e.status ?? e.statusCode;
    return typeof status === 'number' && Number.isSafeInteger(status) ? status : null;
  } catch { return null; }
}

/** Response headers are untrusted and MUST NOT enter any error/log message. */
function safeRetryAfter(error: unknown): string | null {
  try {
    if (!error || typeof error !== 'object') return null;
    const e = error as Record<string, unknown>;
    const h = e.response && typeof e.response === 'object'
      ? (e.response as Record<string, unknown>).headers : e.headers;
    if (!h || typeof h !== 'object') return null;
    const get = (h as { get?: unknown }).get;
    const value = typeof get === 'function'
      ? (get as (name: string) => unknown).call(h, 'retry-after')
      : (h as Record<string, unknown>)['retry-after'];
    return typeof value === 'string' && value.length <= 100 ? value : null;
  } catch { return null; }
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

/**
 * Upstream error may contain raw text or credentials. Never propagate it,
 * attach a cause, or echo its message.
 */
export function sanitizeProviderFailure(error: unknown, signal: AbortSignal): RagEmbeddingError {
  if (signal.aborted) return new RagEmbeddingError('EMBED_ABORTED');
  const status = safeStatus(error);
  if (status === 408 || status === 429 || (status !== null && status >= 500 && status <= 599)) {
    const retryAfterMs = status === 429 || status === 503
      ? parseRetryAfter(safeRetryAfter(error))
      : null;
    return new RagEmbeddingError('EMBED_PROVIDER_TRANSIENT', {
      retryable: true,
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    });
  }
  return new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
}

/**
 * An inert adapter: no import-time provider construction, no key access and
 * no production registration. The real model is created at the FIRST embed
 * call only if explicit paid-call authorization is supplied in a future PR.
 */
export function createOpenAIEmbeddingProvider(
  options: OpenAIRouterOptions = {},
): EmbeddingProvider {
  let modelPromise: Promise<RouterEmbeddingModel> | undefined;

  async function getModel(): Promise<RouterEmbeddingModel> {
    if (!options.modelFactory && options.allowPaidCalls !== true) {
      throw new RagEmbeddingError('EMBED_PAID_NOT_AUTHORIZED');
    }
    if (!modelPromise) {
      modelPromise = Promise.resolve().then(async () => {
        if (options.modelFactory) return options.modelFactory();
        // Mastra 1.83.0: constructor validates the API key; lazy by design.
        const { ModelRouterEmbeddingModel } = await import('@mastra/core/llm');
        return new ModelRouterEmbeddingModel(OPENAI_ROUTER_MODEL_ID) as unknown as RouterEmbeddingModel;
      });
    }
    return modelPromise;
  }

  return Object.freeze({
    spaceId: SPACE.spaceId,
    dimension: SPACE.dimension,
    maxInputsPerCall: MAX_INPUTS_PER_CALL,
    maxInputTokens: MAX_INPUT_TOKENS,
    async embed(
      inputs: readonly string[],
      embedOptions: { signal: AbortSignal; purpose: 'document' | 'query' },
    ): Promise<{ vectors: number[][]; usage: { tokens: number } }> {
      if (!embedOptions || !(embedOptions.signal instanceof AbortSignal) ||
          (embedOptions.purpose !== 'document' && embedOptions.purpose !== 'query') ||
          !Array.isArray(inputs) || inputs.length === 0 ||
          inputs.length > MAX_INPUTS_PER_CALL ||
          inputs.some(value => typeof value !== 'string' || !value.trim())) {
        throw new RagEmbeddingError('EMBED_INVALID_INPUT');
      }
      if (embedOptions.signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
      // The paid-call gate is checked BEFORE touching any secret/provider.
      // Provider initialization can throw secret-bearing errors too.
      let model: RouterEmbeddingModel;
      try { model = await getModel(); }
      catch (error) {
        if (error instanceof RagEmbeddingError) throw error;
        throw sanitizeProviderFailure(error, embedOptions.signal);
      }
      if (embedOptions.signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
      let raw: { embeddings: unknown; usage?: unknown };
      try {
        raw = await model.doEmbed({
          values: [...inputs],
          abortSignal: embedOptions.signal,
        });
      } catch (error) {
        throw sanitizeProviderFailure(error, embedOptions.signal);
      }
      if (embedOptions.signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
      if (!raw || typeof raw !== 'object') throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
      const vectors = validateEmbeddingVectors(raw.embeddings, inputs.length, SPACE.dimension);
      const tokens = requireEmbeddingUsage(raw.usage);
      return { vectors, usage: { tokens } };
    },
  });
}
