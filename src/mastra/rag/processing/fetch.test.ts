import assert from 'node:assert/strict';
import test from 'node:test';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { RagProcessingError } from './errors.ts';
import {
  isPublicIPv4, selectPinnedAddress, fetchApprovedSourceById, fetchManifestSource,
  type PinnedFetcher, type PinnedHttpResponse,
} from './fetch.ts';

const source = SOURCE_MANIFEST[0];
const fixedTime = '2026-11-16T12:00:00.000Z';
const data = Buffer.from('<!doctype html><html><body>Art. 5º Sintético.</body></html>');
function expectedFailure(fn: () => Promise<unknown>, code: string) {
  return assert.rejects(fn, (e: unknown) =>
    e instanceof RagProcessingError && e.code === code && e.message === code);
}

test('public IPv4 only; deny private, CGNAT, link-local, reserved and every IPv6 address', () => {
  for (const address of ['1.1.1.1','8.8.8.8','185.199.108.153']) assert.equal(isPublicIPv4(address),true);
  for (const address of ['127.0.0.1','10.1.2.3','172.16.2.1','192.168.0.1',
    '169.254.169.254','100.64.1.1','198.18.0.1','198.51.100.44',
    '203.0.113.55','192.0.2.44','0.0.0.0','255.255.255.255',
    '::1','fc00::1','2001:db8::1','::ffff:127.0.0.1']) {
    assert.equal(isPublicIPv4(address),false,address);
    assert.throws(() => selectPinnedAddress([address]), /FETCH_UNSAFE_ADDRESS/);
  }
  assert.equal(selectPinnedAddress(['8.8.8.8','1.1.1.1']),'8.8.8.8');
  assert.throws(() => selectPinnedAddress(['8.8.8.8','127.0.0.1']), /FETCH_UNSAFE_ADDRESS/);
});

test('mock transport fetches fixed reviewed source only with DNS-pinned address', async () => {
  const calls: string[] = [];
  const transport: PinnedFetcher = {
    async resolve(host) { calls.push('dns:' + host); return ['8.8.8.8']; },
    async request(url,pinnedIPv4) {
      calls.push('request:' + pinnedIPv4 + ':' + url);
      return {status:200,contentType:'text/html; charset=utf-8',bytes:data};
    },
    now: () => new Date(fixedTime),
  };
  const doc = await fetchApprovedSourceById(source.sourceId,transport);
  assert.equal(doc.sourceId, source.sourceId);
  assert.equal(doc.httpStatus,200);
  assert.equal(doc.finalUri,source.canonicalUri);
  assert.equal(doc.byteSize,data.byteLength);
  assert.equal(doc.fetchedAt,fixedTime);
  assert.equal(doc.charset,'utf-8');
  assert.deepEqual(calls,['dns:www.planalto.gov.br','request:8.8.8.8:'+source.canonicalUri]);
  await expectedFailure(() => fetchApprovedSourceById('https://evil.example/',transport), 'INVALID_DOCUMENT');
});

test('redirects are manually validated, DNS is rechecked and only three hops allowed', async () => {
  const seen: string[] = [];
  let count = 0;
  const transport: PinnedFetcher = {
    async resolve(host) { seen.push('dns:' + host); return ['8.8.4.4']; },
    async request(url,pin): Promise<PinnedHttpResponse> {
      seen.push('request:'+url+':'+pin);
      if (count++ < 2) {
        return {status:302,contentType:'',location:source.canonicalUri+'-redirect'+count,bytes:new Uint8Array()};
      }
      return {status:200,contentType:'text/html',bytes:data};
    },
  };
  const doc = await fetchManifestSource(source,transport);
  assert.ok(doc.finalUri.endsWith('-redirect2'));
  assert.equal(seen.filter(x=>x.startsWith('dns:')).length,3);
});

test('blocks SSRF targets and extra DNS answers before touching transport.request', async () => {
  let requests = 0;
  const transport: PinnedFetcher = {
    async resolve() { return ['8.8.8.8','127.0.0.1']; },
    async request() { requests++; return {status:200,contentType:'text/html',bytes:data}; },
  };
  await expectedFailure(() => fetchManifestSource(source,transport),'FETCH_UNSAFE_ADDRESS');
  assert.equal(requests,0);
});

test('redirects cannot leave official path, introduce credentials or HTTP downgrade', async () => {
  for (const destination of [
    'http://www.planalto.gov.br/ccivil_03/anything.htm',
    'https://evil.example/path',
    'https://www.planalto.gov.br/private/anything.htm',
    'https://www.planalto.gov.br/ccivil_03/a.htm?',
    'https://www.planalto.gov.br/ccivil_03/a.htm#',
    'https://127.0.0.1/ccivil_03/a.htm',
  ]) {
    const transport: PinnedFetcher = {
      resolve: async () => ['8.8.8.8'],
      request: async () => ({status:302,location:destination,contentType:'',bytes:new Uint8Array()}),
    };
    await expectedFailure(() => fetchManifestSource(source,transport),'FETCH_REDIRECT_REJECTED');
  }
});

test('fails after third redirect, or when timeout, invalid responses and oversize responses occur', async () => {
  const transport: PinnedFetcher = {
    resolve: async () => ['8.8.8.8'],
    request: async () => ({status:302,location:source.canonicalUri,contentType:'',bytes:new Uint8Array()}),
  };
  await expectedFailure(() => fetchManifestSource(source,transport),'FETCH_REDIRECT_LIMIT');
  await expectedFailure(() => fetchManifestSource(source,{
    ...transport,request:async () => {throw new Error('secret transport failure');},
  }),'FETCH_TIMEOUT');
  await expectedFailure(() => fetchManifestSource(source,{
    ...transport,request:async () => ({status:200,contentType:'text/html',bytes:new Uint8Array(5*1024*1024+1)}),
  }),'FETCH_INVALID_RESPONSE');
  await expectedFailure(() => fetchManifestSource(source,{
    ...transport,request:async () => ({status:500,contentType:'text/html',bytes:new Uint8Array()}),
  }),'FETCH_HTTP_STATUS');
});

test('only operator-curated manifest entries can be supplied, even on allowlisted hosts', async () => {
  const transport: PinnedFetcher = {
    resolve: async () => ['8.8.8.8'],
    request: async () => ({status:200,contentType:'text/html',bytes:data}),
  };
  await expectedFailure(() => fetchManifestSource({
    ...source,canonicalUri:source.canonicalUri+'-unreviewed',
  },transport),'INVALID_DOCUMENT');
});
