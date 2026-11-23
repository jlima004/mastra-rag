import { readFileSync } from 'node:fs';
import { sha256, documentId } from '../src/mastra/rag/contracts/ids.ts';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import type { FetchedDocument } from '../src/mastra/rag/contracts/types.ts';
import { processFetchedDocumentOffline } from '../src/mastra/rag/processing/index.ts';
import {
  H9_TOKEN_GRID_PROFILES, renderH9TokenGridOffline,
} from '../src/mastra/rag/processing/token-grid.ts';
import { estimateH11EmbeddingCostMicroUsd } from '../src/mastra/rag/embeddings/spend-policy.ts';

const source = SOURCE_MANIFEST[0];
const bytes = readFileSync(new URL('../src/mastra/rag/processing/fixtures/synthetic-lgpd.html', import.meta.url));
const fetched: FetchedDocument = {
  sourceId: source.sourceId,
  documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
  canonicalUri: source.canonicalUri, finalUri: source.canonicalUri,
  httpStatus: 200, declaredMediaType: 'text/html; charset=utf-8',
  sniffedMediaType: 'text/html', charset: 'utf-8', byteSize: bytes.length,
  contentSha256: sha256(bytes), fetchedAt: '2026-11-23T00:00:00.000Z', bytes,
};
const { normalized, chunkSet: proxy } = processFetchedDocumentOffline(fetched, source);

function percentile(values: readonly number[], q: number): number {
  const arr = [...values].sort((a, b) => a - b);
  return arr[Math.ceil(q * arr.length) - 1];
}
const report = H9_TOKEN_GRID_PROFILES.map(config => {
  const set = renderH9TokenGridOffline(normalized, fetched, source, config);
  const tokenCounts = set.chunks.map(c => c.tokenCount);
  const batchTotals: number[] = [];
  for (let i = 0; i < tokenCounts.length; i += 128)
    batchTotals.push(tokenCounts.slice(i, i + 128).reduce((sum, n) => sum + n, 0));
  const reservation = set.totalTokens + 3 * Math.max(0, ...batchTotals);
  const normative = normalized.blocks.filter(b => b.kind !== 'heading');
  const lost = normative.filter(b =>
    set.chunks.every(c => c.charStart >= b.end || c.charEnd <= b.start)).length;
  const mismatchedOffsets = set.chunks.filter(c =>
    normalized.normalizedText.slice(c.charStart, c.charEnd) !== c.body).length;
  return {
    strategy: config.strategy,
    maxTokens: config.maxTokens,
    overlapTokens: config.overlapTokens,
    profileId: set.profileId,
    renderedChunkSetId: set.chunkSetId,
    count: set.chunks.length,
    totalTokens: set.totalTokens,
    p50: percentile(tokenCounts, 0.5),
    p95: percentile(tokenCounts, 0.95),
    maxObserved: Math.max(...tokenCounts),
    overTarget: tokenCounts.filter(n => n > config.maxTokens).length,
    normativeBlocksWithoutIntersection: lost,
    offsetMismatches: mismatchedOffsets,
    retryInclusiveReservation: reservation,
    estimatedRetryInclusiveMicroUsd: String(estimateH11EmbeddingCostMicroUsd(reservation)),
    exceedsH11Job150k: reservation > 150_000,
  };
});
process.stdout.write(JSON.stringify({
  gate: 'H9C_SYNTHETIC_TOKEN_GRID_ONLY',
  sourceEvidence: 'synthetic-fixture-not-authoritative-law',
  liveAdmissionApproved: false,
  tokenizer: 'cl100k_base/js-tiktoken@1.0.21',
  fixtureSha256: sha256(bytes),
  normalizedSha256: normalized.normalizedSha256,
  historicalByteProxyProfileId: proxy.profileId,
  historicalRenderedChunkSetId: proxy.chunkSetId,
  profiles: report,
}, null, 2) + '\n');
