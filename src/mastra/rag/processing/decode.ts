import { sha256, documentId } from '../contracts/ids.ts';
import { RAG_LIMITS, type FetchedDocument, type SourceManifestEntry, type SourceMediaType } from '../contracts/types.ts';
import { sniffSupportedMediaType } from '../contracts/validation.ts';
import { RagProcessingError } from './errors.ts';

const SUPPORTED_CHARSETS = new Map([
  ['utf-8', 'utf-8'], ['utf8', 'utf-8'],
  ['iso-8859-1', 'windows-1252'], ['latin1', 'windows-1252'],
  ['windows-1252', 'windows-1252'], ['cp1252', 'windows-1252'],
]);

function normalizeCharset(raw: string | null): string | null {
  if (raw === null) return null;
  const value = SUPPORTED_CHARSETS.get(raw.toLowerCase().trim());
  if (!value) throw new RagProcessingError('DECODE_INVALID_CHARSET');
  return value;
}

function detectMetaCharset(bytes: Uint8Array): string | null {
  // HTTP-compatible encoding labels in meta are ASCII even on legacy HTML pages.
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).toString('latin1');
  const tags = head.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const match = /\bcharset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(tag);
    if (match) return match[1];
  }
  return null;
}

export function detectDocumentCharset(
  contentType: string,
  bytes: Uint8Array,
  media: SourceMediaType,
): string {
  const declared = /(?:^|;)\s*charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i.exec(contentType)?.[1] ?? null;
  const byHeader = normalizeCharset(declared);
  const byMeta = media === 'text/html' ? normalizeCharset(detectMetaCharset(bytes)) : null;
  if (byHeader && byMeta && byHeader !== byMeta) {
    throw new RagProcessingError('DECODE_CHARSET_CONFLICT');
  }
  return byHeader ?? byMeta ?? 'utf-8';
}

export function decodeFetchedDocument(
  doc: FetchedDocument,
  source: SourceManifestEntry,
): string {
  if (doc.sourceId !== source.sourceId || doc.canonicalUri !== source.canonicalUri ||
      doc.documentId !== documentId(source.tenantId, source.sourceId, source.canonicalUri) ||
      doc.httpStatus !== 200 || !(doc.bytes instanceof Uint8Array) ||
      doc.bytes.byteLength === 0 || doc.bytes.byteLength > RAG_LIMITS.MAX_RAW_BYTES ||
      doc.byteSize !== doc.bytes.byteLength || doc.contentSha256 !== sha256(doc.bytes) ||
      !Number.isFinite(Date.parse(doc.fetchedAt)) ||
      !source.expectedMediaTypes.includes(doc.sniffedMediaType)) {
    throw new RagProcessingError('INVALID_DOCUMENT');
  }
  let sniffed: SourceMediaType;
  try { sniffed = sniffSupportedMediaType(doc.bytes, source.expectedMediaTypes); }
  catch { throw new RagProcessingError('INVALID_DOCUMENT'); }
  if (sniffed !== doc.sniffedMediaType) throw new RagProcessingError('INVALID_DOCUMENT');
  const charset = detectDocumentCharset(doc.declaredMediaType, doc.bytes, sniffed);
  if (charset !== doc.charset) throw new RagProcessingError('DECODE_INVALID_CHARSET');
  try {
    const text = new TextDecoder(charset, { fatal: true }).decode(doc.bytes);
    if (text.includes('\u0000') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
      throw new RagProcessingError('DECODE_INVALID_CHARSET');
    }
    return text;
  } catch {
    throw new RagProcessingError('DECODE_INVALID_CHARSET');
  }
}
