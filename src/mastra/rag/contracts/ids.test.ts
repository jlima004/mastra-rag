import assert from 'node:assert/strict';
import test from 'node:test';
import { RagContractError } from './errors.ts';
import {
  canonicalJson, sha256, documentId, documentVersionId, pipelineProfileId,
  chunkSetId, chunkId, ingestionIdempotencyKey,
} from './ids.ts';

const tenant = 'public';
const source = 'br-planalto-lei-13709-2018';
const uri = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
const raw = '<html><body><p>SYNTHETIC FIXTURE v1 - Art. 7o O tratamento de dados pessoais somente podera ser realizado...</p></body></html>';
const profile = {
  chunker: {
    contextHeader: 'breadcrumb+caput', maxTokens: 512, overlapTokens: 0,
    strategy: 'legal-structure', tokenizer: 'cl100k_base',
  },
  extractor: 'planalto-html@1',
  normalizer: 'legal-text@1',
};

test('SPEC §6.4 deterministic golden values are exact', () => {
  const id = documentId(tenant, source, uri);
  assert.equal(id, '0576788e68201edab1001d5dba38f3112b9997c0a0e8b8ba1dc5d583d1daf9d9');
  const content = sha256(Buffer.from(raw, 'utf8'));
  assert.equal(content, '34bc80504a24a69f8875c9a85a30dae3848dbd296e74f7e9df56914074c40b01');
  const version = documentVersionId(id, content);
  assert.equal(version, 'bde5cd017a33d52b0a7df051d5a482aa724bbc83fb11db74ff934befdab3cc4d');
  const profileId = pipelineProfileId(profile);
  assert.equal(profileId, 'f6386d1544823c2fd720bc32bfe464b3db63f2fd977d83a113858f0253bfb6e4');
  const set = chunkSetId(version, profileId);
  assert.equal(set, '1c06cde7975bca1af7bb6af4af9842e4a956741afcc526cb17bff97316866aed');
  assert.equal(chunkId(set, 7), '527045310342c432257b099e1e632e21e8d47d0d6a20d41591cae6b44983d4ed');
  assert.equal(
    ingestionIdempotencyKey(id, content, profileId, 'chunks_te3s_1536_v1'),
    'fb7c0b88b541872fa9a19e33b7980cf217c1b13735af8934aa7f970b0a59a74c',
  );
});

test('raw byte hashing differs from normalised text and content revisions', () => {
  assert.notEqual(sha256(Buffer.from('a\r\nb')), sha256(Buffer.from('a\nb')));
  assert.notEqual(sha256(Buffer.from(raw)), sha256(Buffer.from(raw.replace('v1', 'v2'))));
  const doc = documentId(tenant, source, uri);
  assert.notEqual(
    documentVersionId(doc, sha256(Buffer.from(raw))),
    documentVersionId(doc, sha256(Buffer.from(raw.replace('v1', 'v2')))),
  );
  assert.notEqual(documentId('public', source + '-v2', uri), doc);
});

test('canonical JSON sorts recursively and is independent of insertion order', () => {
  const reordered = {
    normalizer: 'legal-text@1', extractor: 'planalto-html@1',
    chunker: {
      tokenizer: 'cl100k_base', strategy: 'legal-structure',
      overlapTokens: 0, maxTokens: 512, contextHeader: 'breadcrumb+caput',
    },
  };
  assert.equal(pipelineProfileId(reordered), pipelineProfileId(profile));
  assert.equal(canonicalJson({ b: 2, a: { z: null, c: [true, false] } }),
    '{"a":{"c":[true,false],"z":null},"b":2}');
});

test('hash components cannot contain delimiters, NULLs or invalid unicode', () => {
  for (const value of ['x\ny', 'x\ry', 'x\0y', '', '\ud800']) {
    assert.throws(() => documentId(tenant, value, uri),
      (error: unknown) => error instanceof RagContractError && error.code === 'INVALID_HASH_COMPONENT');
  }
  assert.throws(() => chunkId('abc', -1), /INVALID_HASH_COMPONENT/);
  assert.throws(() => chunkId('abc', 1.1), /INVALID_HASH_COMPONENT/);
  assert.throws(() => chunkId('abc', Number.MAX_SAFE_INTEGER + 1), /INVALID_HASH_COMPONENT/);
});

test('canonical serialization rejects unrepresentable, cyclic and executable input', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const dangerous: Record<string, unknown> = {};
  Object.defineProperty(dangerous, 'private', { enumerable: true, get() { throw new Error('SECRET'); } });
  for (const value of [NaN, Infinity, -0, undefined, () => 1, BigInt(1), cyclic, new Date(), dangerous, '\ud800']) {
    assert.throws(() => canonicalJson(value),
      (error: unknown) => error instanceof RagContractError && error.code === 'INVALID_CANONICAL_JSON');
  }
  const protoKey = JSON.parse('{"__proto__":7}') as object;
  assert.throws(() => canonicalJson(protoKey), /INVALID_CANONICAL_JSON/);
});

test('id spaces and ordinals are distinct and reproducible', () => {
  const d = documentId(tenant, source, uri);
  const v = documentVersionId(d, 'a'.repeat(64));
  const p = pipelineProfileId(profile);
  const set = chunkSetId(v, p);
  assert.equal(chunkId(set, 0), chunkId(set, 0));
  assert.notEqual(chunkId(set, 0), chunkId(set, 1));
  assert.notEqual(chunkId(set, 7), ingestionIdempotencyKey(d, 'a'.repeat(64), p, 'chunks_te3s_1536_v1'));
  assert.notEqual(chunkId(set, 7), chunkId(chunkSetId(v, 'b'.repeat(64)), 7));
});
