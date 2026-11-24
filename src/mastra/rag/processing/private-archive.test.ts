import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
import {
  lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sha256, documentId } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import type { FetchedDocument } from '../contracts/types.ts';
import { openH9CPrivateArchiveDirectory, type H9CArchiveReceipt } from './private-archive.ts';
import { assessH9CQuarantinedResponse } from './source-quarantine.ts';

const SOURCE = SOURCE_MANIFEST[0];
function evidence(raw: Uint8Array): { name: string; receipt: H9CArchiveReceipt } {
  const hash = sha256(raw);
  return {
    name: SOURCE.sourceId + '-' + hash,
    receipt: {
      sourceId: SOURCE.sourceId,
      rawSha256: hash,
      byteSize: raw.byteLength,
      officialLegalTextAccepted: false,
      snapshotSemanticallyReviewed: false,
      paidAdmissionApproved: false,
    },
  };
}
function tempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'h9c-archive-r1-'));
}
function directoryFiles(path: string): string[] {
  return readdirSync(path).sort();
}
function fetchedFromSynthetic(raw: Buffer): FetchedDocument {
  return {
    sourceId: SOURCE.sourceId,
    documentId: documentId(SOURCE.tenantId, SOURCE.sourceId, SOURCE.canonicalUri),
    canonicalUri: SOURCE.canonicalUri,
    finalUri: SOURCE.canonicalUri,
    httpStatus: 200,
    declaredMediaType: 'text/html; charset=utf-8',
    sniffedMediaType: 'text/html',
    charset: 'utf-8',
    byteSize: raw.byteLength,
    contentSha256: sha256(raw),
    fetchedAt: '2026-11-23T00:00:00.000Z',
    bytes: raw,
  };
}

test('H9C R1 publishes raw and receipt with mode 0600 only after complete staging', () => {
  const dir = tempDirectory();
  const raw = Buffer.from('<html><p>Art. 1º Texto jurídico sintético.</p></html>');
  const { name, receipt } = evidence(raw);
  const archive = openH9CPrivateArchiveDirectory(dir);
  try {
    archive.publish(name, raw, receipt);
    const files = directoryFiles(dir);
    assert.deepEqual(files, [name + '.receipt.json', name + '.source.html']);
    assert.deepEqual(readFileSync(join(dir, name + '.source.html')), raw);
    assert.equal(statSync(join(dir, name + '.source.html')).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, name + '.receipt.json')).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(join(dir, name + '.receipt.json'), 'utf8')).paidAdmissionApproved, false);
    assert.throws(() => archive.publish(name, raw, receipt), /H9C_ARCHIVE_FAILED/);
    assert.deepEqual(directoryFiles(dir), files, 'must not overwrite or leave stages');
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('H9C R1 refuses checkout-contained evidence even when the caller cwd is elsewhere', () => {
  const path = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.h9c-checkout-r1-'));
  const cwd = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.throws(() => openH9CPrivateArchiveDirectory(path), /H9C_UNSAFE_OUTPUT_DIRECTORY/);
  } finally {
    process.chdir(cwd);
    rmSync(path, { recursive: true, force: true });
  }
});

test('H9C R1 pinned directory handle defeats an ancestor path-swap symlink', () => {
  const parent = tempDirectory();
  const original = join(parent, 'private');
  const moved = join(parent, 'original-moved');
  const publicDecoy = join(parent, 'world-readable');
  mkdirSync(original, { mode: 0o700 });
  mkdirSync(publicDecoy, { mode: 0o755 });
  const archive = openH9CPrivateArchiveDirectory(original);
  try {
    renameSync(original, moved);
    symlinkSync(publicDecoy, original, 'dir');
    const raw = Buffer.from('safe synthetic body');
    const { name, receipt } = evidence(raw);
    assert.throws(() => archive.publish(name, raw, receipt), /H9C_UNSAFE_OUTPUT_DIRECTORY/);
    assert.deepEqual(directoryFiles(publicDecoy), [], 'decoy must not receive source bytes');
    assert.deepEqual(directoryFiles(moved), [], 'original should not receive committed bytes');
  } finally {
    archive.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test('H9C R1 cleans partially staged raw and receipt files after injected write errors', () => {
  for (const failingPart of ['raw', 'receipt'] as const) {
    const dir = tempDirectory();
    const archive = openH9CPrivateArchiveDirectory(dir);
    const raw = Buffer.from('public synthetic source; absolutely no secret');
    const { name, receipt } = evidence(raw);
    try {
      assert.throws(() => archive.publish(name, raw, receipt, (fd, bytes, part) => {
        if (part === failingPart) {
          writeSync(fd, bytes.subarray(0, 5));
          throw new Error('disk-full-injection: synthetic source content must not leak');
        }
        writeSync(fd, bytes);
      }), /H9C_ARCHIVE_FAILED/);
      assert.deepEqual(directoryFiles(dir), [], 'no partial final or staging evidence');
      archive.publish(name, raw, receipt);
      assert.equal(directoryFiles(dir).length, 2, 'retry works after injection');
    } finally {
      archive.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('H9C R1 receipt name collision rolls back only current raw publication', () => {
  const dir = tempDirectory();
  const archive = openH9CPrivateArchiveDirectory(dir);
  const raw = Buffer.from('collision fixture');
  const { name, receipt } = evidence(raw);
  const preserved = Buffer.from('pre-existing receipt: never delete or overwrite');
  const path = join(dir, name + '.receipt.json');
  writeFileSync(path, preserved, { flag: 'wx', mode: 0o600 });
  try {
    assert.throws(() => archive.publish(name, raw, receipt), /H9C_ARCHIVE_FAILED/);
    assert.deepEqual(directoryFiles(dir), [basename(path)]);
    assert.deepEqual(readFileSync(path), preserved);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('H9C R1 refuses symlink directory and mode-0755 output', () => {
  const root = tempDirectory();
  const real = join(root, 'private');
  const alias = join(root, 'symlink');
  const permissive = join(root, 'permissive');
  mkdirSync(real, { mode: 0o700 });
  mkdirSync(permissive, { mode: 0o755 });
  symlinkSync(real, alias, 'dir');
  try {
    assert.equal(lstatSync(alias).isSymbolicLink(), true);
    assert.throws(() => openH9CPrivateArchiveDirectory(alias), /H9C_UNSAFE_OUTPUT_DIRECTORY/);
    assert.throws(() => openH9CPrivateArchiveDirectory(permissive), /H9C_UNSAFE_OUTPUT_DIRECTORY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('H9C R1 rejects invalid document identity and never publishes raw bytes', () => {
  const dir = tempDirectory();
  const archive = openH9CPrivateArchiveDirectory(dir);
  try {
    assert.throws(() => archive.publish('../escape', Buffer.from('x'), {
      sourceId: SOURCE.sourceId, rawSha256: 'a'.repeat(64), byteSize: 1,
    }), /H9C_ARCHIVE_INPUT_INVALID/);
    assert.deepEqual(directoryFiles(dir), []);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('H9C R1 quarantines unsupported HTML as unaccepted official content without raw exception', () => {
  const raw = Buffer.from('<!doctype html><html><p>Art. 1º Dados &nonsense; fictícios</p></html>');
  const fetched = fetchedFromSynthetic(raw);
  const a = assessH9CQuarantinedResponse(fetched, SOURCE);
  assert.equal(a.extractionStatus, 'unsupported');
  assert.equal(a.extractionErrorCode, 'EXTRACT_UNSUPPORTED_ENTITY');
  assert.equal(a.normalizedSha256, null);
  assert.equal(a.officialLegalTextAccepted, false);
  assert.equal(a.snapshotSemanticallyReviewed, false);
  assert.equal(a.paidAdmissionApproved, false);
  assert.equal(JSON.stringify(a).includes('nonsense'), false);
  const dir = tempDirectory();
  const archive = openH9CPrivateArchiveDirectory(dir);
  try {
    const { name, receipt } = evidence(raw);
    archive.publish(name, raw, { ...receipt, ...a });
    assert.deepEqual(readFileSync(join(dir, name + '.source.html')), raw);
    const archived = JSON.parse(readFileSync(join(dir, name + '.receipt.json'), 'utf8'));
    assert.equal(archived.extractionStatus, 'unsupported');
    assert.equal(archived.officialLegalTextAccepted, false);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('H9C R1 marks parseable synthetic HTML unreviewed, never legally accepted', () => {
  const raw = Buffer.from('<!doctype html><html><p>Art. 1º Texto sintético.</p></html>');
  const a = assessH9CQuarantinedResponse(fetchedFromSynthetic(raw), SOURCE);
  assert.equal(a.extractionStatus, 'unreviewed-parsed');
  assert.match(a.normalizedSha256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal(a.officialLegalTextAccepted, false);
  assert.equal(a.snapshotSemanticallyReviewed, false);
});
