import { RagContractError } from './errors.ts';
import { RAG_LIMITS, type SourceExtractor, type SourceManifestEntry, type SourceMediaType } from './types.ts';

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;
const MEDIA_TYPES: readonly SourceMediaType[] = ['text/html', 'text/markdown', 'text/plain'];
const EXTRACTORS: readonly SourceExtractor[] =
  ['planalto-html@1', 'dou-html@1', 'markdown@1', 'plaintext@1'];
const ALLOWED_KEYS = ['sourceId', 'tenantId', 'kind', 'canonicalUri', 'expectedMediaTypes', 'extractor', 'title', 'license', 'language'];
const LICENSE_KEYS = ['kind', 'reference'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/**
 * Never read untrusted accessor properties. Return a null-prototype record of
 * own data values with exactly the declared keys or reject it as malformed.
 */
function safeDataRecord(input: unknown, requiredKeys: readonly string[]): Record<string, unknown> | null {
  if (!isPlainObject(input)) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== requiredKeys.length) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of requiredKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

/** Defend all untrusted array inputs against holes and accessor side effects. */
function safeDataArray(input: unknown, maxLength: number): unknown[] | null {
  try {
    if (!Array.isArray(input) || input.length === 0 || input.length > maxLength) return null;
    if (Object.keys(input).length !== input.length ||
        Object.getOwnPropertySymbols(input).length > 0) return null;
    const values: unknown[] = [];
    for (let index = 0; index < input.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !('value' in descriptor)) return null;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

/**
 * Syntax-time URL and hostname control. This is NOT a network SSRF defense:
 * Step C MUST pin checked DNS answers at connect time and validate redirects.
 */
export function validateCanonicalSourceUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048 ||
      !input.startsWith('https://') || input.includes('?') || input.includes('#') ||
      /[\\%\s\x00-\x1f\x7f]/.test(input)) {
    throw new RagContractError('UNSAFE_SOURCE_URL');
  }
  let parsed: URL;
  try { parsed = new URL(input); }
  catch { throw new RagContractError('UNSAFE_SOURCE_URL'); }
  const permitted =
    (parsed.hostname === 'www.planalto.gov.br' && parsed.pathname.startsWith('/ccivil_03/')) ||
    (parsed.hostname === 'www.in.gov.br' && parsed.pathname.startsWith('/en/web/dou/-/'));
  if (!permitted || parsed.protocol !== 'https:' || parsed.href !== input ||
      parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
      parsed.pathname.includes('//') || parsed.pathname.endsWith('/')) {
    throw new RagContractError('UNSAFE_SOURCE_URL');
  }
  return parsed.href;
}

/** Parser-free Step B validation; no fetching, DNS resolution, or URL auto-correction. */
export function validateSourceManifestEntry(input: unknown): SourceManifestEntry {
  const data = safeDataRecord(input, ALLOWED_KEYS);
  if (!data) throw new RagContractError('INVALID_MANIFEST_ENTRY');
  if (typeof data.sourceId !== 'string' || !SOURCE_ID.test(data.sourceId)) {
    throw new RagContractError('INVALID_SOURCE_ID');
  }
  const canonicalUri = validateCanonicalSourceUrl(data.canonicalUri);
  if (data.tenantId !== 'public' || data.kind !== 'http' ||
      data.language !== 'pt-BR' || typeof data.title !== 'string' ||
      data.title.trim().length === 0 || data.title.length > 240 ||
      typeof data.extractor !== 'string' || !EXTRACTORS.includes(data.extractor as SourceExtractor)) {
    throw new RagContractError('INVALID_MANIFEST_ENTRY');
  }
  const media = safeDataArray(data.expectedMediaTypes, MEDIA_TYPES.length);
  if (!media || media.some(value => !MEDIA_TYPES.includes(value as SourceMediaType)) ||
      new Set(media).size !== media.length) {
    throw new RagContractError('INVALID_MANIFEST_ENTRY');
  }
  const types = media as SourceMediaType[];
  const extractor = data.extractor as SourceExtractor;
  if ((extractor === 'planalto-html@1' &&
         (!canonicalUri.startsWith('https://www.planalto.gov.br/') || !types.includes('text/html'))) ||
      (extractor === 'dou-html@1' &&
         (!canonicalUri.startsWith('https://www.in.gov.br/') || !types.includes('text/html'))) ||
      (extractor === 'markdown@1' && !types.includes('text/markdown')) ||
      (extractor === 'plaintext@1' && !types.includes('text/plain'))) {
    throw new RagContractError('INVALID_MANIFEST_ENTRY');
  }
  const license = safeDataRecord(data.license, LICENSE_KEYS);
  if (!license || !['official-act-br', 'cc-by-4.0', 'other'].includes(String(license.kind)) ||
      typeof license.reference !== 'string' ||
      !license.reference.trim() || license.reference.length > 500) {
    throw new RagContractError('INVALID_MANIFEST_ENTRY');
  }
  return Object.freeze({
    sourceId: data.sourceId, tenantId: 'public', kind: 'http',
    canonicalUri, expectedMediaTypes: Object.freeze([...types]),
    extractor, title: data.title, language: 'pt-BR',
    license: Object.freeze({
      kind: license.kind as SourceManifestEntry['license']['kind'],
      reference: license.reference as string,
    }),
  });
}

export function validateSourceManifest(input: unknown): readonly SourceManifestEntry[] {
  const values = safeDataArray(input, 100);
  if (!values) throw new RagContractError('INVALID_MANIFEST_ENTRY');
  const entries = values.map(validateSourceManifestEntry);
  if (new Set(entries.map(e => e.sourceId)).size !== entries.length ||
      new Set(entries.map(e => e.canonicalUri)).size !== entries.length) {
    throw new RagContractError('DUPLICATE_SOURCE');
  }
  return Object.freeze(entries);
}

/** Only source IDs may enter an eventual ingestion request, never raw URLs. */
export function resolveSourceIds(
  requested: unknown,
  approved: readonly SourceManifestEntry[],
): readonly SourceManifestEntry[] {
  const values = safeDataArray(requested, approved.length);
  if (!values || values.some(x => typeof x !== 'string' || !SOURCE_ID.test(x))) {
    throw new RagContractError('INVALID_SOURCE_ID');
  }
  const ids = values as string[];
  if (new Set(ids).size !== ids.length) throw new RagContractError('INVALID_SOURCE_ID');
  const entries = new Map(approved.map(e => [e.sourceId, e]));
  return Object.freeze(ids.map(id => {
    const entry = entries.get(id);
    if (!entry) throw new RagContractError('INVALID_SOURCE_ID');
    return entry;
  }));
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

/**
 * Signature/media sniff only. HTML may use a legacy charset; decoding and
 * authoritative charset detection are deferred to Step C.
 */
export function sniffSupportedMediaType(
  input: unknown, expected: readonly SourceMediaType[],
): SourceMediaType {
  if (!(input instanceof Uint8Array)) throw new RagContractError('INVALID_INPUT');
  if (input.byteLength === 0) throw new RagContractError('EMPTY_CONTENT');
  if (input.byteLength > RAG_LIMITS.MAX_RAW_BYTES) {
    throw new RagContractError('RAW_BYTES_EXCEEDED');
  }
  if (!Array.isArray(expected) || expected.length === 0 ||
      expected.some(t => !MEDIA_TYPES.includes(t))) {
    throw new RagContractError('INVALID_INPUT');
  }
  if (startsWithBytes(input, [0x25,0x50,0x44,0x46,0x2d]) || // %PDF-
      startsWithBytes(input, [0x50,0x4b,0x03,0x04]) || // ZIP
      startsWithBytes(input, [0x1f,0x8b]) || // gzip
      startsWithBytes(input, [0x89,0x50,0x4e,0x47]) || // PNG
      startsWithBytes(input, [0x7f,0x45,0x4c,0x46])) { // ELF
    throw new RagContractError('UNSUPPORTED_MEDIA_TYPE');
  }
  const sample = input.subarray(0, Math.min(input.byteLength, 4096));
  for (const byte of input) {
    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
      throw new RagContractError('BINARY_CONTENT_REJECTED');
    }
  }
  const ascii = Buffer.from(sample).toString('latin1').replace(/^ï»¿/, '').trimStart();
  const html = /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b|<!--|<meta\b)/i.test(ascii);
  let detected: SourceMediaType;
  if (html) {
    detected = 'text/html';
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { throw new RagContractError('BINARY_CONTENT_REJECTED'); }
    const looksLikeMarkdown = /^(?:#{1,6}\s|\*\s|\-\s|```)/m.test(text);
    detected = expected.includes('text/markdown') && (looksLikeMarkdown || !expected.includes('text/plain'))
      ? 'text/markdown' : 'text/plain';
  }
  if (!expected.includes(detected)) throw new RagContractError('MEDIA_TYPE_MISMATCH');
  return detected;
}
