import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';

const script = new URL('../../../../scripts/h9c-inspect-quarantine.ts', import.meta.url);
const source = SOURCE_MANIFEST[1];
const raw = Buffer.from('<!doctype html><html><title>Private synthetic test title</title><p>Art. 1º inventado.</p></html>');
function setup(): { dir: string; rawName: string; receiptName: string } {
  const dir = mkdtempSync(join(tmpdir(), 'h9c-operator-inspect-'));
  chmodSync(dir, 0o700);
  const digest = sha256(raw);
  const root = source.sourceId + '-' + digest;
  const rawName = join(dir, root + '.source.html');
  const receiptName = join(dir, root + '.receipt.json');
  const receipt = {
    evidenceClass: 'operator-readonly-acquisition-quarantined',
    sourceId: source.sourceId, canonicalUri: source.canonicalUri,
    finalUri: source.canonicalUri, status: 200,
    mediaType: 'text/html', charset: 'utf-8', byteSize: raw.byteLength,
    rawSha256: digest, extractionStatus: 'unsupported',
    extractionErrorCode: 'EXTRACT_UNSUPPORTED_HTML',
    evidenceFileBasename: root + '.source.html',
    officialLegalTextAccepted: false,
    snapshotSemanticallyReviewed: false, paidAdmissionApproved: false,
  };
  writeFileSync(rawName, raw, { flag: 'wx', mode: 0o600 });
  writeFileSync(receiptName, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  return { dir, rawName, receiptName };
}
function run(dir: string) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script.pathname, dir], {
    encoding: 'utf8', timeout: 10_000,
  });
}

test('H9C operator CLI validates synthetic private receipt without leaking HTML/URL', () => {
  const fixture = setup();
  try {
    const result = run(fixture.dir);
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.gate, 'H9C_OPERATOR_PRIVATE_QUARANTINE_INSPECTION');
    assert.equal(data.snapshotLegalAcceptance, false);
    assert.equal(data.allSourcesReviewed, false);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].receiptIntegrityVerified, true);
    assert.equal(data.results[0].officialLegalTextAccepted, false);
    assert.equal(data.sourceStatus.filter((x: {status:string}) => x.status === 'not-captured').length, 2);
    assert.ok(!result.stdout.includes('Private synthetic test title'));
    assert.ok(!result.stdout.includes(source.canonicalUri));
    assert.ok(!result.stdout.includes(fixture.dir));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('H9C operator CLI refuses symlinked raw evidence and never prints target contents', () => {
  const fixture = setup();
  try {
    rmSync(fixture.rawName);
    symlinkSync(fixture.receiptName, fixture.rawName);
    const result = run(fixture.dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /H9C_INSPECTION_FAILED/);
    assert.ok(!result.stderr.includes(fixture.dir));
    assert.ok(!result.stdout.includes('Private synthetic test title'));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('H9C operator CLI refuses untrusted file permissions and tampered raw evidence', () => {
  const fixture = setup();
  try {
    chmodSync(fixture.rawName, 0o644);
    assert.equal(run(fixture.dir).status, 1);
    chmodSync(fixture.rawName, 0o600);
    writeFileSync(fixture.rawName, Buffer.from('modified synthetic bytes'));
    assert.equal(run(fixture.dir).status, 1);
    assert.ok(readFileSync(fixture.receiptName).byteLength > 0,
      'evidence remains untouched on verification failure');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});


test('H9C operator CLI refuses credential/path injection in an otherwise valid receipt', () => {
  const fixture = setup();
  try {
    const receipt = JSON.parse(readFileSync(fixture.receiptName, 'utf8'));
    receipt.extractionErrorCode =
      'Authorization: Bearer synthetic-credential\n/tmp/h9c-private/secret.html';
    writeFileSync(fixture.receiptName, JSON.stringify(receipt));
    const result = run(fixture.dir);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'H9C_INSPECTION_FAILED');
    assert.ok(!result.stderr.includes('synthetic-credential'));
    assert.ok(!result.stderr.includes(fixture.dir));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
