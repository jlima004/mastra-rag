import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { documentId, documentVersionId, sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';

const script = fileURLToPath(new URL('../../../../scripts/h9c-evaluate-dou.ts', import.meta.url));
const source = SOURCE_MANIFEST.find(item => item.extractor === 'dou-html@1')!;
const marker = 'Palavra privada fictícia 🧪';
const heading = 'RESOLUÇÃO CD/ANPD Nº 84, DE 7 DE JANEIRO DE 2098';
const raw = Buffer.from('<!doctype html><html><head>' +
  '<script>// <![CDATA[\nthrow new Error("Código inventado que não executa");\n</script>' +
  '</head><body><article id="materia"><div><div class="texto-dou"><html><head></head><body>' +
  '<p class="identifica">' + heading + '</p>' +
  '<p class="ementa">Ementa inventada.</p>' +
  '<p class="dou-paragraph">Art. 1º ' + marker + '</p>' +
  '<p class="dou-paragraph">I - Condição inventada.</p>' +
  '</body></html></div></div></article></body></html>');
const rawSha256 = sha256(raw);

function createFixture(bytes = raw) {
  const digest = sha256(bytes);
  const basename = source.sourceId + '-' + digest;
  const directory = mkdtempSync(join(tmpdir(), 'h9c-c2-evaluation-'));
  chmodSync(directory, 0o700);
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
    fetchedAt: '2026-11-24T18:00:00.000Z',
    byteSize: bytes.byteLength,
    rawSha256: digest,
    decodedSha256: sha256(bytes.toString('utf8')),
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
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  writeFileSync(rawPath, bytes, { mode: 0o600, flag: 'wx' });
  writeFileSync(receiptPath, receiptBytes, { mode: 0o600, flag: 'wx' });
  return { directory, rawPath, receiptPath, receipt, receiptBytes, digest };
}

function run(directory: string, receiptSha256: string, sourceId = source.sourceId, digest = rawSha256) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', script,
    directory, sourceId, digest, receiptSha256, '2',
  ], { encoding: 'utf8', timeout: 15_000 });
}

test('H9C-C2 offline CLI pins input and emits aggregate candidate comparison and identities', () => {
  const fixture = createFixture();
  try {
    // Adjacent archive entries are never selected implicitly.
    writeFileSync(join(fixture.directory, 'other-evidence.txt'), marker, { mode: 0o600 });
    const receiptSha256 = sha256(fixture.receiptBytes);
    const result = run(fixture.directory, receiptSha256);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.gate, 'H9C_C2_OFFLINE_DOU_EVALUATION');
    assert.equal(report.sourceId, source.sourceId);
    assert.equal(report.rawSha256, rawSha256);
    assert.equal(report.receiptSha256, receiptSha256);
    assert.equal(report.receiptIntegrityVerified, true);
    assert.equal(report.decodedUtf16, raw.toString('utf8').length);
    assert.equal(report.documentId, documentId(source.tenantId, source.sourceId, source.canonicalUri));
    assert.equal(report.documentVersionId, documentVersionId(report.documentId, rawSha256));
    assert.equal(report.legacy.agreesWithReceipt, true);
    assert.equal(report.legacy.extractionErrorCode, 'EXTRACT_UNSUPPORTED_HTML');
    assert.equal(report.extractor, 'dou-html@2');
    assert.equal(report.candidate.classification, 'DOU_CANDIDATE_EXTRACTION_PASS_UNREVIEWED');
    assert.equal(report.candidate.admissibleContainers, 1);
    assert.equal(report.candidate.headerAssociation, 'associated');
    assert.equal(report.candidate.normalization.structuralCounts.article, 1);
    assert.equal(report.candidate.normalization.structuralCounts.inciso, 1);
    assert.equal(report.candidate.normalization.verifiedUtf16Offsets, report.candidate.blockCount);
    assert.equal(report.repeatability.repetitions, 2);
    assert.equal(report.repeatability.verified, true);
    assert.equal(report.resources.measurements.length, 2);
    assert.equal(report.byteProxyIdentities.length, 2);
    for (const profile of report.byteProxyIdentities) {
      assert.equal(profile.identityVerified, true);
      assert.equal(profile.verifiedOffsetCount, profile.chunkCount);
    }
    assert.equal(report.officialLegalTextAccepted, false);
    assert.equal(report.snapshotSemanticallyReviewed, false);
    assert.equal(report.paidAdmissionApproved, false);
    for (const secret of [marker, heading, fixture.directory, source.canonicalUri, 'Código inventado']) {
      assert.ok(!result.stdout.includes(secret));
    }
    assert.deepEqual(readFileSync(fixture.rawPath), raw);
    assert.deepEqual(readFileSync(fixture.receiptPath), fixture.receiptBytes);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('H9C-C2 offline CLI refuses altered or nonprivate evidence and requires valid explicit selection', () => {
  const fixture = createFixture();
  const receiptSha256 = sha256(fixture.receiptBytes);
  function refused(result: ReturnType<typeof run>) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'H9C_C2_EVALUATION_FAILED');
  }
  try {
    assert.equal(run(fixture.directory, receiptSha256, 'br-planalto-lei-13709-2018').status, 2);
    assert.equal(run(fixture.directory, 'not-a-hash').status, 2);
    refused(run(fixture.directory, '0'.repeat(64)));

    const markedAccepted = Buffer.from(JSON.stringify({
      ...fixture.receipt, officialLegalTextAccepted: true, extractionErrorCode: marker,
    }));
    writeFileSync(fixture.receiptPath, markedAccepted);
    refused(run(fixture.directory, sha256(markedAccepted)));

    const wrongDecodedDigest = Buffer.from(JSON.stringify({
      ...fixture.receipt, decodedSha256: '0'.repeat(64),
    }));
    writeFileSync(fixture.receiptPath, wrongDecodedDigest);
    refused(run(fixture.directory, sha256(wrongDecodedDigest)));

    writeFileSync(fixture.receiptPath, fixture.receiptBytes);
    chmodSync(fixture.rawPath, 0o644);
    refused(run(fixture.directory, receiptSha256));
    chmodSync(fixture.rawPath, 0o600);
    rmSync(fixture.rawPath);
    symlinkSync(fixture.receiptPath, fixture.rawPath);
    refused(run(fixture.directory, receiptSha256));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('H9C-C2 offline CLI reports fixed aggregate diagnostics for incomplete extraction', () => {
  const missingHeader = Buffer.from(raw.toString('utf8').replace('class="identifica"', 'class="dou-paragraph"'));
  const fixture = createFixture(missingHeader);
  try {
    const result = run(fixture.directory, sha256(fixture.receiptBytes), source.sourceId, fixture.digest);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.candidate.classification, 'DOU_CANDIDATE_STRUCTURAL_INCOMPLETE');
    assert.equal(report.candidate.headerAssociation, 'missing');
    assert.equal(report.candidate.structuralCompleteness, 'incomplete');
    assert.equal(report.candidate.normalization, null);
    assert.deepEqual(report.byteProxyIdentities, []);
    assert.equal(report.repeatability.verified, true);
    assert.ok(!result.stdout.includes(marker));
    assert.ok(!result.stdout.includes(heading));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('H9C-C2 locator metadata digests repeated heading context without replaying its text', () => {
  const chapter = 'CAPÍTULO I ' + 'x'.repeat(1500);
  const additional = '<p>' + chapter + '</p><p>Art. 2º Artigo fictício adicional.</p>' +
    '<p>Continuação sintética.</p>'.repeat(1000);
  const bytes = Buffer.from(raw.toString('utf8').replace('</body></html></div>', additional + '</body></html></div>'));
  const fixture = createFixture(bytes);
  try {
    const result = run(fixture.directory, sha256(fixture.receiptBytes), source.sourceId, fixture.digest);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const { normalization } = report.candidate;
    assert.equal(report.candidate.classification, 'DOU_CANDIDATE_EXTRACTION_PASS_UNREVIEWED');
    assert.ok(normalization.blocksWithHeadingContext > 1000);
    assert.equal(normalization.locatorMetadataDigest, 'h9c-c2-locator-metadata:v1');
    assert.match(normalization.locatorMetadataSha256, /^[0-9a-f]{64}$/);
    assert.equal(report.repeatability.verified, true);
    assert.ok(!result.stdout.includes(chapter));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
