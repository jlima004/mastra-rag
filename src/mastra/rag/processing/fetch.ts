import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { sha256, documentId } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { RAG_LIMITS, type FetchedDocument, type SourceManifestEntry } from '../contracts/types.ts';
import { validateCanonicalSourceUrl, sniffSupportedMediaType } from '../contracts/validation.ts';
import { detectDocumentCharset } from './decode.ts';
import { RagProcessingError } from './errors.ts';

export type PinnedHttpResponse = Readonly<{
  status: number;
  location?: string;
  contentType: string;
  bytes: Uint8Array;
}>;

export type PinnedFetcher = Readonly<{
  resolve: (host: string) => Promise<readonly string[]>;
  request: (url: string, pinnedIPv4: string) => Promise<PinnedHttpResponse>;
  now?: () => Date;
}>;

const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 60_000;

export function isPublicIPv4(input: string): boolean {
  if (isIP(input) !== 4) return false;
  const octets = input.split('.').map(Number);
  const [a,b,c] = octets;
  // Fail closed for special, private, loopback, link-local, CGNAT,
  // benchmarking, documentation, multicast and reserved address space.
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/**
 * The initial transport intentionally supports IPv4 only. IPv6 DNS answers
 * fail closed, including ULA and v4-mapped addresses. H9 is required before
 * broadening address handling; no automatic DNS fallback is permitted.
 */
export function selectPinnedAddress(addresses: readonly string[]): string {
  if (!Array.isArray(addresses) || addresses.length === 0 ||
      addresses.some(ip => typeof ip !== 'string' || !isPublicIPv4(ip))) {
    throw new RagProcessingError('FETCH_UNSAFE_ADDRESS');
  }
  return addresses[0];
}

/**
 * Pure options builder used by the real native transport and offline tests.
 * Disable auto family selection AND honor all:true if Node asks for it,
 * while keeping TLS hostname verification and the verified IPv4 pinned.
 */
export function pinnedHttpsRequestOptions(urlValue: string, address: string): RequestOptions {
  if (!isPublicIPv4(address)) throw new RagProcessingError('FETCH_UNSAFE_ADDRESS');
  const url = new URL(validateCanonicalSourceUrl(urlValue));
  return {
    hostname: url.hostname, servername: url.hostname, port: 443,
    method: 'GET', path: url.pathname, agent: false,
    family: 4,
    rejectUnauthorized: true, timeout: CONNECT_TIMEOUT_MS,
    headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.1', 'user-agent': 'mastra-rag-source-validation/1.0' },
    lookup(_hostname, options, callback) {
      if (options.all) callback(null, [{ address, family: 4 }]);
      else callback(null, address, 4);
    },
  };
}

/** Native HTTPS client: the verified DNS address is pinned by lookup(). */
export async function requestPinnedHttps(urlValue: string, address: string): Promise<PinnedHttpResponse> {
  const options = pinnedHttpsRequestOptions(urlValue, address);
  return new Promise<PinnedHttpResponse>((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, value?: PinnedHttpResponse): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const req = request(options, res => {
      const contentLength = Number(res.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > RAG_LIMITS.MAX_RAW_BYTES) {
        req.destroy(new RagProcessingError('FETCH_BYTES_EXCEEDED'));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > RAG_LIMITS.MAX_RAW_BYTES) {
          req.destroy(new RagProcessingError('FETCH_BYTES_EXCEEDED'));
          return;
        }
        chunks.push(chunk);
      });
      res.once('error', error => finish(error));
      res.once('end', () => finish(undefined, {
        status: res.statusCode ?? 0,
        location: typeof res.headers.location === 'string' ? res.headers.location : undefined,
        contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : '',
        bytes: Buffer.concat(chunks, length),
      }));
    });
    req.once('timeout', () => req.destroy(new RagProcessingError('FETCH_TIMEOUT')));
    req.once('error', error => finish(error));
    timer = setTimeout(() => req.destroy(new RagProcessingError('FETCH_TIMEOUT')), TOTAL_TIMEOUT_MS);
    req.end();
  });
}

export const NATIVE_PINNED_FETCHER: PinnedFetcher = Object.freeze({
  async resolve(host) {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map(item => item.address);
  },
  request: requestPinnedHttps,
});

/**
 * Invoked only explicitly by an authorized operator in a future step.
 * No route, job or scheduler calls this function in Step C.
 * Test transport uses synthetic responses and never accesses the internet.
 */
export async function fetchApprovedSourceById(
  requestedId: string,
  transport: PinnedFetcher = NATIVE_PINNED_FETCHER,
): Promise<FetchedDocument> {
  const source = SOURCE_MANIFEST.find(item => item.sourceId === requestedId);
  if (!source) throw new RagProcessingError('INVALID_DOCUMENT');
  return fetchManifestSource(source, transport);
}

export async function fetchManifestSource(
  source: SourceManifestEntry,
  transport: PinnedFetcher,
): Promise<FetchedDocument> {
  const approved = SOURCE_MANIFEST.find(item =>
    item.sourceId === source.sourceId && item.canonicalUri === source.canonicalUri);
  if (!approved) throw new RagProcessingError('INVALID_DOCUMENT');
  let current = validateCanonicalSourceUrl(approved.canonicalUri);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let addresses: readonly string[];
    try { addresses = await transport.resolve(new URL(current).hostname); }
    catch { throw new RagProcessingError('FETCH_DNS_FAILED'); }
    const pin = selectPinnedAddress(addresses);
    let result: PinnedHttpResponse;
    try { result = await transport.request(current, pin); }
    catch (error) {
      if (error instanceof RagProcessingError) throw error;
      throw new RagProcessingError('FETCH_TIMEOUT');
    }
    if (!result || !Number.isSafeInteger(result.status) ||
        !(result.bytes instanceof Uint8Array) ||
        result.bytes.byteLength > RAG_LIMITS.MAX_RAW_BYTES) {
      throw new RagProcessingError('FETCH_INVALID_RESPONSE');
    }
    if (result.status >= 300 && result.status < 400) {
      if (redirects === MAX_REDIRECTS) throw new RagProcessingError('FETCH_REDIRECT_LIMIT');
      if (!result.location || result.location.length > 2048) {
        throw new RagProcessingError('FETCH_REDIRECT_REJECTED');
      }
      try {
        const candidate = new URL(result.location, current);
        current = validateCanonicalSourceUrl(candidate.href);
      } catch {
        throw new RagProcessingError('FETCH_REDIRECT_REJECTED');
      }
      continue;
    }
    if (result.status !== 200) throw new RagProcessingError('FETCH_HTTP_STATUS');
    let media: ReturnType<typeof sniffSupportedMediaType>;
    try { media = sniffSupportedMediaType(result.bytes, source.expectedMediaTypes); }
    catch { throw new RagProcessingError('FETCH_INVALID_RESPONSE'); }
    const charset = detectDocumentCharset(result.contentType, result.bytes, media);
    const fetchedAt = (transport.now ?? (() => new Date()))().toISOString();
    return Object.freeze({
      sourceId: source.sourceId,
      documentId: documentId(source.tenantId, source.sourceId, source.canonicalUri),
      canonicalUri: source.canonicalUri,
      finalUri: current,
      httpStatus: 200 as const,
      declaredMediaType: result.contentType,
      sniffedMediaType: media,
      charset,
      byteSize: result.bytes.byteLength,
      contentSha256: sha256(result.bytes),
      fetchedAt,
      bytes: result.bytes,
    });
  }
  throw new RagProcessingError('FETCH_REDIRECT_LIMIT');
}
