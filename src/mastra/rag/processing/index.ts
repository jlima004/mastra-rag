import type { FetchedDocument, SourceManifestEntry } from '../contracts/types.ts';
import { decodeFetchedDocument } from './decode.ts';
import { extractHtmlBlocks, extractTextBlocks } from './html.ts';
import { normalizeLegalBlocks } from './legal.ts';
import { makeOfflineChunkSet, STRUCTURAL_PROXY_CONFIG, type OfflineChunkConfig } from './chunk.ts';

/** No network, database, model, or runtime side effects. */
export function processFetchedDocumentOffline(
  fetched: FetchedDocument,
  source: SourceManifestEntry,
  config: OfflineChunkConfig = STRUCTURAL_PROXY_CONFIG,
) {
  const decoded = decodeFetchedDocument(fetched, source);
  const blocks = fetched.sniffedMediaType === 'text/html'
    ? extractHtmlBlocks(decoded)
    : extractTextBlocks(decoded, fetched.sniffedMediaType);
  const normalized = normalizeLegalBlocks(blocks, source);
  return Object.freeze({
    normalized,
    chunkSet: makeOfflineChunkSet(normalized, fetched, source, config),
  });
}
