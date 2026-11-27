import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { calibrateMvpDocuments } from '../../../../scripts/h9c-grid-mvp.ts';
import { documentId, documentVersionId, sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { evaluateDouCandidate } from './dou-evaluation.ts';
import { MVP_EXPERIMENTAL_CORPUS, type MvpSnapshotPin, validateMvpSnapshot } from './mvp-corpus.ts';

const CLI = fileURLToPath(new URL('../../../../scripts/h9c-grid-mvp.ts', import.meta.url));
const PRIVATE_MARKER = 'Trecho inventado de uso privado 🧪';

function writeFixture(directory: string, selection: MvpSnapshotPin, number: number) {
  const source = SOURCE_MANIFEST.find(entry => entry.sourceId === selection.sourceId)!;
  const html = '<!doctype html><html><head><script>// <![CDATA[\n</script></head>' +
    '<body><article id="materia"><div><div class="texto-dou"><html><head></head><body>' +
    '<p class="identifica">RESOLUÇÃO CD/ANPD Nº ' + number + ', DE 7 DE JANEIRO DE 2098</p>' +
    '<p class="ementa">Ementa sintética.</p><p>Art. 1º ' + PRIVATE_MARKER + '</p>' +
    '<p>ANEXO</p><p>CAPÍTULO I</p><p>Art. 1º Artigo sintético.</p>' +
    '<p>Parágrafo único. Condição inventada.</p><p>I - Requisito inventado.</p>' +
    '</body></html></div></div></article></body></html>';
  const raw = Buffer.from(html);
  const rawSha256 = sha256(raw);
  const id = documentId(source.tenantId, source.sourceId, source.canonicalUri);
  const basename = source.sourceId + '-' + rawSha256;
  const rawPath = join(directory, basename + '.source.html');
  const receiptPath = join(directory, basename + '.receipt.json');
  const receipt = {
    evidenceClass: 'operator-readonly-acquisition-quarantined',
    sourceId: source.sourceId,
    canonicalUri: source.canonicalUri,
    finalUri: source.canonicalUri,
    status: 200,
    mediaType: 'text/html',
    declaredMediaType: 'text/html; charset=utf-8',
    charset: 'utf-8',
    fetchedAt: '2026-01-07T12:00:00.000Z',
    byteSize: raw.length,
    rawSha256,
    decodedSha256: sha256(html),
    normalizedSha256: null,
    extractor: source.extractor,
    extractionStatus: 'unsupported',
    extractionErrorCode: 'EXTRACT_UNSUPPORTED_HTML',
    blocks: null,
    evidenceFileBasename: basename + '.source.html',
    officialLegalTextAccepted: false,
    snapshotSemanticallyReviewed: false,
    paidAdmissionApproved: false,
  };
  const receiptBytes = JSON.stringify(receipt);
  const { summary } = evaluateDouCandidate(html, source);
  assert.equal(summary.classification, 'DOU_CANDIDATE_EXTRACTION_PASS_UNREVIEWED');
  const structure = summary.normalization!;
  const pin: MvpSnapshotPin = {
    ...selection,
    documentId: id,
    documentVersionId: documentVersionId(id, rawSha256),
    rawSha256,
    receiptSha256: sha256(receiptBytes),
    normalizedSha256: structure.normalizedSha256,
    extractedBlocksSha256: summary.extractedBlocksSha256!,
    locatorMetadataSha256: structure.locatorMetadataSha256,
    fetchedAt: receipt.fetchedAt,
    byteSize: raw.length,
    blocks: structure.blockCount,
    explicitLocators: structure.uniqueExplicitLegalUnitLocators,
    mainArticles: 1,
    annexArticles: 1,
  };
  writeFileSync(rawPath, raw, { mode: 0o600, flag: 'wx' });
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600, flag: 'wx' });
  return { pin, raw, rawPath, receipt, receiptPath, receiptBytes };
}

test('MVP selects exactly the two ANPD sources and leaves the active manifest legacy', () => {
  const { snapshots, extractor, legalCertificationApproved, productionActivationApproved,
    paidAdmissionApproved } = MVP_EXPERIMENTAL_CORPUS;
  assert.deepEqual(snapshots.map(pin => pin.sourceId), ['br-anpd-res-15-2024', 'br-anpd-res-18-2024']);
  assert.equal(extractor, 'dou-html@2');
  assert.equal(legalCertificationApproved, false);
  assert.equal(productionActivationApproved, false);
  assert.equal(paidAdmissionApproved, false);
  assert.deepEqual(SOURCE_MANIFEST.map(source => [source.sourceId, source.extractor]), [
    ['br-planalto-lei-13709-2018', 'planalto-html@1'],
    ['br-anpd-res-15-2024', 'dou-html@1'],
    ['br-anpd-res-18-2024', 'dou-html@1'],
  ]);
  assert.throws(() => validateMvpSnapshot('/unused', {
    ...snapshots[0], sourceId: SOURCE_MANIFEST[0].sourceId, canonicalUri: SOURCE_MANIFEST[0].canonicalUri,
  }), { code: 'MVP_SOURCE_MANIFEST_MISMATCH' });
});

test('MVP reuses private pairs and renders the same documents in every offline profile', t => {
  const directory = mkdtempSync(join(tmpdir(), 'h9c-mvp-fixtures-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixtures = MVP_EXPERIMENTAL_CORPUS.snapshots.map((pin, index) =>
    writeFixture(directory, pin, 84 + index));

  const networkDenied = () => assert.fail('offline driver attempted a network operation');
  const fetch = t.mock.method(globalThis, 'fetch', networkDenied);
  const connect = t.mock.method(Socket.prototype, 'connect', networkDenied);
  const documents = fixtures.map(({ pin }) => validateMvpSnapshot(directory, pin));
  const frozenTitle = 'Título histórico fixado no corpus';
  assert.equal(validateMvpSnapshot(directory, { ...fixtures[0].pin, title: frozenTitle }).source.title,
    frozenTitle);
  const first = calibrateMvpDocuments(documents);
  const second = calibrateMvpDocuments(documents);
  assert.deepEqual(first.profiles.map(result => result.profile), ['S256', 'S512', 'S1024', 'R400']);
  assert.deepEqual(first.profiles, second.profiles);
  for (const result of first.profiles) {
    assert.deepEqual(result.documents.map(doc => doc.sourceId), fixtures.map(({ pin }) => pin.sourceId));
    assert.equal(result.cost.measured.totalTokens, result.chunking.totalTokens);
    assert.equal(result.chunking.overLimit, 0);
    assert.equal(result.renderingRepeatable, true);
  }
  for (const { rawPath, raw, receiptPath, receiptBytes } of fixtures) {
    assert.deepEqual(readFileSync(rawPath), raw);
    assert.equal(readFileSync(receiptPath, 'utf8'), receiptBytes);
  }
  const publicReport = JSON.stringify(first);
  for (const value of [PRIVATE_MARKER, 'Ementa sintética.', 'Condição inventada.', directory]) {
    assert.ok(!publicReport.includes(value));
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
});

test('MVP rejects altered hashes and inconsistent private pairs without emitting evidence', t => {
  const directory = mkdtempSync(join(tmpdir(), 'h9c-mvp-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = writeFixture(directory, MVP_EXPERIMENTAL_CORPUS.snapshots[0], 84);
  const { pin, receiptPath, rawPath } = fixture;
  const wrongDigest = '0'.repeat(64);
  assert.throws(() => validateMvpSnapshot(directory, { ...pin, receiptSha256: wrongDigest }),
    { code: 'MVP_QUARANTINE_PAIR_INVALID' });
  assert.throws(() => validateMvpSnapshot(directory, { ...pin, normalizedSha256: wrongDigest }),
    { code: 'MVP_C2_STRUCTURE_MISMATCH' });
  assert.throws(() => validateMvpSnapshot(directory, { ...pin, locatorMetadataSha256: wrongDigest }),
    { code: 'MVP_C2_STRUCTURE_MISMATCH' });

  const swapped = JSON.stringify({ ...fixture.receipt, sourceId: MVP_EXPERIMENTAL_CORPUS.snapshots[1].sourceId });
  writeFileSync(receiptPath, swapped);
  assert.throws(() => validateMvpSnapshot(directory, { ...pin, receiptSha256: sha256(swapped) }),
    { code: 'MVP_QUARANTINE_PAIR_INVALID' });
  writeFileSync(receiptPath, fixture.receiptBytes);
  // Change a byte without changing the selected receipt, size or basename.
  const altered = Buffer.from(fixture.raw);
  altered[0] ^= 1;
  writeFileSync(rawPath, altered);
  assert.throws(() => validateMvpSnapshot(directory, pin), { code: 'MVP_QUARANTINE_PAIR_INVALID' });

  // The real entry point has no digest or source override, even for valid invented fixtures.
  const refusal = spawnSync(process.execPath, ['--experimental-strip-types', CLI, directory], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(refusal.status, 1, refusal.error);
  assert.equal(refusal.stdout, '');
  assert.equal(refusal.stderr.trim(), 'MVP_QUARANTINE_PAIR_INVALID');
  const usage = spawnSync(process.execPath, ['--experimental-strip-types', CLI, directory, pin.sourceId],
    { encoding: 'utf8', timeout: 15_000 });
  assert.equal(usage.status, 2, usage.error);
  assert.equal(usage.stdout, '');
  assert.equal(usage.stderr.trim(), 'H9C_MVP_GRID_USAGE_INVALID');
});
