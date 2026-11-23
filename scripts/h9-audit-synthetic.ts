import { readFileSync } from 'node:fs';
import { documentId, sha256 } from '../src/mastra/rag/contracts/ids.ts';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import type { FetchedDocument } from '../src/mastra/rag/contracts/types.ts';
import { processFetchedDocumentOffline } from '../src/mastra/rag/processing/index.ts';
import {
  auditH9PinnedSyntheticChunks,
  H9_PINNED_TOKENIZER,
} from '../src/mastra/rag/processing/cl100k-counter.ts';

const source = SOURCE_MANIFEST[0];
const bytes = readFileSync(new URL('../src/mastra/rag/processing/fixtures/synthetic-lgpd.html', import.meta.url));
const fetched: FetchedDocument = {
  sourceId: source.sourceId,
  documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
  canonicalUri: source.canonicalUri,
  finalUri: source.canonicalUri,
  httpStatus: 200,
  declaredMediaType: 'text/html; charset=utf-8',
  sniffedMediaType: 'text/html',
  charset: 'utf-8',
  byteSize: bytes.byteLength,
  contentSha256: sha256(bytes),
  fetchedAt: '2026-11-23T00:00:00.000Z',
  bytes,
};

const { chunkSet } = processFetchedDocumentOffline(fetched, source);
const report = auditH9PinnedSyntheticChunks(chunkSet.chunks);

// No raw legal text or model inputs are ever logged.
// This is a measurement of already-rendered BYTE-proxy chunks,
// NOT a 256/512/1024-token rechunking experiment.
const receipt = Object.freeze({
  gate: 'H9B_OFFLINE_SYNTHETIC_ONLY',
  sourceClassification: 'synthetic-untrusted-not-legal-corpus',
  tokenizer: H9_PINNED_TOKENIZER,
  fixtureSha256: sha256(bytes),
  pipelineProfileId: chunkSet.profileId,
  renderedChunkSetId: chunkSet.chunkSetId,
  currentChunker: chunkSet.tokenizer,
  report,
});
process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
