import { createHash } from 'node:crypto';
import { RagEmbeddingError } from '../embeddings/errors.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import { countH9Cl100kTokens } from '../processing/cl100k-counter.ts';
import { SPACE } from './catalog.ts';

type FakeResponse = Awaited<ReturnType<EmbeddingProvider['embed']>>;
type FakeMode = 'ok' | '429' | '5xx' | 'timeout' | 'absent_usage' | 'invalid_usage' |
  'overage' | 'wrong_dimension' | 'nonfinite' | 'permanent';

export function createFakeEmbeddingProvider(
  selectMode: (call: number, signal: AbortSignal) => FakeMode | Promise<FakeMode> = () => 'ok',
  maxInputsPerCall = 128,
) {
  let calls = 0;
  const provider: EmbeddingProvider = Object.freeze({
    spaceId: SPACE.spaceId,
    dimension: SPACE.dimension,
    maxInputsPerCall,
    maxInputTokens: 8191,
    async embed(inputs: readonly string[], { signal }: Parameters<EmbeddingProvider['embed']>[1]) {
      const mode = await selectMode(++calls, signal);
      if (mode === '429' || mode === '5xx') {
        throw new RagEmbeddingError('EMBED_PROVIDER_TRANSIENT', { retryable: true, retryAfterMs: 1 });
      }
      if (mode === 'timeout') throw new RagEmbeddingError('EMBED_ABORTED');
      if (mode === 'permanent') throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');

      const vectors = inputs.map(input => {
        const hash = createHash('sha256').update(input).digest();
        return Array.from({ length: SPACE.dimension }, (_, i) => (1 + hash[i % hash.length]) / 256);
      });
      if (mode === 'wrong_dimension') vectors[0].pop();
      if (mode === 'nonfinite') vectors[0][0] = Infinity;
      const measured = inputs.reduce((sum, input) => sum + countH9Cl100kTokens(input), 0);
      if (mode === 'absent_usage') return { vectors } as FakeResponse;
      const tokens = mode === 'invalid_usage' ? NaN : measured + Number(mode === 'overage');
      return { vectors, usage: { tokens } };
    },
  });
  return { provider, calls: () => calls };
}
