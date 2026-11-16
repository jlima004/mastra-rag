import assert from 'node:assert/strict';
import test from 'node:test';
import { RagContractError } from './errors.ts';
import { RAG_LIMITS, type SourceManifestEntry } from './types.ts';
import {
  validateCanonicalSourceUrl, validateSourceManifestEntry, validateSourceManifest,
  resolveSourceIds, sniffSupportedMediaType,
} from './validation.ts';

const lgpd = {
  sourceId: 'br-planalto-lei-13709-2018', tenantId: 'public', kind: 'http',
  canonicalUri: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
  expectedMediaTypes: ['text/html'],
  extractor: 'planalto-html@1',
  title: 'Lei nº 13.709/2018',
  license: { kind: 'official-act-br', reference: 'Lei 9.610/1998 art. 8 IV' },
  language: 'pt-BR',
};

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof RagContractError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test('accepts strict official URLs without silently rewriting them', () => {
  assert.equal(validateCanonicalSourceUrl(lgpd.canonicalUri), lgpd.canonicalUri);
  const dou = 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-18-de-16-de-julho-de-2024-572632074';
  assert.equal(validateCanonicalSourceUrl(dou), dou);
});

test('rejects SSRF-like URLs and injected URL components before any networking', () => {
  const unsafe = [
    'http://www.planalto.gov.br/ccivil_03/lei.htm',
    'https://www.planalto.gov.br.evil.example/ccivil_03/lei.htm',
    'https://www.planalto.gov.br@127.0.0.1/ccivil_03/lei.htm',
    'https://admin:pw@www.planalto.gov.br/ccivil_03/lei.htm',
    'https://www.planalto.gov.br:444/ccivil_03/lei.htm',
    'https://127.0.0.1/ccivil_03/lei.htm',
    'https://[::1]/ccivil_03/lei.htm',
    'https://169.254.169.254/ccivil_03/lei.htm',
    'https://localhost/ccivil_03/lei.htm',
    'https://www.planalto.gov.br/other/lei.htm',
    'https://www.in.gov.br/other/lei.htm',
    'https://www.in.gov.br/en/web/dou/-/res.htm?next=secret',
    'https://www.in.gov.br/en/web/dou/-/res.htm#section',
    lgpd.canonicalUri + '?',
    lgpd.canonicalUri + '#',
    lgpd.canonicalUri + '?#',
    'https://www.in.gov.br/en/web/dou/-/%2e%2e/private',
    'https://www.in.gov.br/en/web/dou/-/a%2fb',
    'https://www.in.gov.br/en/web/dou/-//evil',
    'https://www.in.gov.br/en/web/dou/-/../secret',
    'https://www.planalto.gov.br/ccivil_03/x\\@attacker.example/',
    'https://www.planalto.gov.br./ccivil_03/lei.htm',
    'https://www.PLANALTO.gov.br/ccivil_03/lei.htm',
  ];
  for (const url of unsafe) expectCode(() => validateCanonicalSourceUrl(url), 'UNSAFE_SOURCE_URL');
  expectCode(() => validateCanonicalSourceUrl({ url: lgpd.canonicalUri }), 'UNSAFE_SOURCE_URL');
});

test('validates manifest entry fields and extracts a safe frozen copy', () => {
  const source = validateSourceManifestEntry(lgpd);
  assert.equal(source.sourceId, lgpd.sourceId);
  assert.equal(source.tenantId, 'public');
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.expectedMediaTypes), true);
  assert.equal(Object.isFrozen(source.license), true);
  expectCode(() => validateSourceManifestEntry({ ...lgpd, token: 'SECRET' }), 'INVALID_MANIFEST_ENTRY');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, sourceId: 'bad\nsource' }), 'INVALID_SOURCE_ID');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, tenantId: 'other' }), 'INVALID_MANIFEST_ENTRY');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, language: 'en-US' }), 'INVALID_MANIFEST_ENTRY');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, license: {kind: 'official-act-br', reference: ''} }), 'INVALID_MANIFEST_ENTRY');
  // Values with array/string coercion must not masquerade as an enum member.
  const mutableLicenseKind = ['official-act-br'];
  expectCode(
    () => validateSourceManifestEntry({
      ...lgpd, license: { kind: mutableLicenseKind, reference: 'official act' },
    }),
    'INVALID_MANIFEST_ENTRY',
  );
  const maliciousLicenseKind = {
    toString() { throw new Error('SECRET-license'); },
  };
  expectCode(
    () => validateSourceManifestEntry({
      ...lgpd, license: { kind: maliciousLicenseKind, reference: 'official act' },
    }),
    'INVALID_MANIFEST_ENTRY',
  );
  // A valid primitive enum member must remain accepted, immutable and a string.
  const valid = validateSourceManifestEntry(lgpd);
  assert.equal(valid.license.kind, 'official-act-br');
  assert.equal(typeof valid.license.kind, 'string');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, expectedMediaTypes: ['text/html', 'text/html'] }), 'INVALID_MANIFEST_ENTRY');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, expectedMediaTypes: ['application/pdf'] }), 'INVALID_MANIFEST_ENTRY');
  expectCode(() => validateSourceManifestEntry({ ...lgpd, extractor: 'dou-html@1' }), 'INVALID_MANIFEST_ENTRY');
});

test('sourceId selection permits known IDs only, never caller-controlled URLs', () => {
  const entries = validateSourceManifest([lgpd]);
  assert.deepEqual(resolveSourceIds([lgpd.sourceId], entries).map(x => x.sourceId), [lgpd.sourceId]);
  const getterIds = [lgpd.sourceId];
  Object.defineProperty(getterIds, '0', { enumerable: true, get() { throw new Error('SECRET-id'); } });
  expectCode(() => resolveSourceIds(getterIds, entries), 'INVALID_SOURCE_ID');
  for (const invalid of [
    new Array(1), [lgpd.canonicalUri], ['unknown-legal-source'], [lgpd.sourceId, lgpd.sourceId],
    [], 'br-planalto-lei-13709-2018',
  ]) expectCode(() => resolveSourceIds(invalid, entries), 'INVALID_SOURCE_ID');
});

test('rejects duplicate IDs and URLs in the reviewed source manifest', () => {
  expectCode(() => validateSourceManifest([lgpd, { ...lgpd, title: 'Another title' }]), 'DUPLICATE_SOURCE');
  expectCode(() => validateSourceManifest([lgpd, { ...lgpd, sourceId: 'different-source' }]), 'DUPLICATE_SOURCE');
  expectCode(() => validateSourceManifest([]), 'INVALID_MANIFEST_ENTRY');
  expectCode(() => validateSourceManifest(new Array(1)), 'INVALID_MANIFEST_ENTRY');
  const arrayWithGetter = [lgpd];
  Object.defineProperty(arrayWithGetter, '0', {
    enumerable: true, configurable: true, get() { throw new Error('SECRET-manifest'); },
  });
  expectCode(() => validateSourceManifest(arrayWithGetter), 'INVALID_MANIFEST_ENTRY');
  const fieldGetter = { ...lgpd };
  Object.defineProperty(fieldGetter, 'sourceId', {
    enumerable: true, get() { throw new Error('SECRET-property'); },
  });
  expectCode(() => validateSourceManifestEntry(fieldGetter), 'INVALID_MANIFEST_ENTRY');
});

test('sniffs HTML, Markdown and plain UTF-8 text without fetching', () => {
  const data = (value: string) => Buffer.from(value, 'utf8');
  assert.equal(sniffSupportedMediaType(data('<!DOCTYPE html>\n<html><body>Lei</body></html>'), ['text/html']), 'text/html');
  assert.equal(sniffSupportedMediaType(data('# Título\n\nArtigo.'), ['text/markdown']), 'text/markdown');
  assert.equal(sniffSupportedMediaType(data('Texto simples\nsem HTML.'), ['text/plain']), 'text/plain');
  assert.equal(sniffSupportedMediaType(data('# Heading but declared plain'), ['text/plain']), 'text/plain');
  expectCode(() => sniffSupportedMediaType(data('<html><body>x</body></html>'), ['text/plain']), 'MEDIA_TYPE_MISMATCH');
  expectCode(() => sniffSupportedMediaType(data('Texto'), ['text/html']), 'MEDIA_TYPE_MISMATCH');
});

test('rejects PDF, archives, binary content, zero bytes and over-limit input', () => {
  expectCode(() => sniffSupportedMediaType(new Uint8Array(), ['text/plain']), 'EMPTY_CONTENT');
  expectCode(() => sniffSupportedMediaType(Buffer.from('%PDF-1.7\nabc'), ['text/html']), 'UNSUPPORTED_MEDIA_TYPE');
  expectCode(() => sniffSupportedMediaType(Buffer.from([0x50,0x4b,0x03,0x04,0x00]), ['text/plain']), 'UNSUPPORTED_MEDIA_TYPE');
  expectCode(() => sniffSupportedMediaType(Buffer.from([0x00,0x42]), ['text/plain']), 'BINARY_CONTENT_REJECTED');
  expectCode(() => sniffSupportedMediaType(Buffer.from([0xc3,0x28]), ['text/plain']), 'BINARY_CONTENT_REJECTED');
  const lateBinary = Buffer.alloc(5000, 65);
  lateBinary[4500] = 0;
  expectCode(() => sniffSupportedMediaType(lateBinary, ['text/plain']), 'BINARY_CONTENT_REJECTED');
  const lateHtmlBinary = Buffer.concat([Buffer.from('<html>'), Buffer.alloc(5000, 65)]);
  lateHtmlBinary[4500] = 0;
  expectCode(() => sniffSupportedMediaType(lateHtmlBinary, ['text/html']), 'BINARY_CONTENT_REJECTED');
  expectCode(() => sniffSupportedMediaType(new Uint8Array(RAG_LIMITS.MAX_RAW_BYTES + 1), ['text/plain']), 'RAW_BYTES_EXCEEDED');
});

test('preserves HTML legacy-charset bytes for later extraction stage', () => {
  const latin1 = Buffer.from([60,104,116,109,108,62,32,0xe7,32,60,47,104,116,109,108,62]);
  assert.equal(sniffSupportedMediaType(latin1, ['text/html']), 'text/html');
  // Charset detection and TextDecoder are explicitly a Step C responsibility.
});

test('error messages never reflect untrusted URLs or secret-bearing fields', () => {
  const secret = 'secret-value-NEVER-LOG';
  try { validateSourceManifestEntry({ ...lgpd, canonicalUri: 'https://secret-value-NEVER-LOG.example/' }); }
  catch (error) {
    assert.ok(error instanceof RagContractError);
    assert.doesNotMatch(JSON.stringify({ message: error.message, code: error.code }), new RegExp(secret));
  }
});
