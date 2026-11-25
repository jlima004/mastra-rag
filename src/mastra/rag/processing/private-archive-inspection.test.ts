import assert from 'node:assert/strict';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import { openH9CPrivateArchiveDirectory } from './private-archive.ts';

const source = SOURCE_MANIFEST[1];

test('H9C R2 inspector reads safe evidence via pinned descriptor, not path input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h9c-read-fd-'));
  chmodSync(dir, 0o700);
  const bytes = Buffer.from('synthetic page only', 'utf8');
  const filename = source.sourceId + '-' + sha256(bytes) + '.source.html';
  writeFileSync(join(dir, filename), bytes, { flag: 'wx', mode: 0o600 });
  const archive = openH9CPrivateArchiveDirectory(dir);
  try {
    assert.deepEqual([...archive.listEvidenceNames()], [filename]);
    assert.deepEqual(archive.readEvidenceBytes(filename, 4096), bytes);
    assert.throws(() => archive.readEvidenceBytes('../.env', 4096),
      /H9C_UNSAFE_OUTPUT_DIRECTORY/);
    assert.throws(() => archive.readEvidenceBytes(filename, 1),
      /H9C_UNSAFE_OUTPUT_DIRECTORY/);
    assert.deepEqual(readdirSync(dir), [filename], 'read operations are nonmutating');
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('H9C R2 inspector fails closed when a directory changes after fd pinning', () => {
  const root = mkdtempSync(join(tmpdir(), 'h9c-read-swap-'));
  const origin = join(root, 'private');
  const moved = join(root, 'renamed');
  const decoy = join(root, 'decoy');
  mkdirSync(origin, { mode: 0o700 });
  mkdirSync(decoy, { mode: 0o700 });
  const originalBytes = Buffer.from('original synthetic', 'utf8');
  const decoyBytes = Buffer.from('attacker synthetic', 'utf8');
  const filename = source.sourceId + '-' + sha256(originalBytes) + '.source.html';
  writeFileSync(join(origin, filename), originalBytes, { mode: 0o600 });
  writeFileSync(join(decoy, filename), decoyBytes, { mode: 0o600 });
  const archive = openH9CPrivateArchiveDirectory(origin);
  try {
    assert.deepEqual(archive.readEvidenceBytes(filename, 4096), originalBytes);
    renameSync(origin, moved);
    symlinkSync(decoy, origin, 'dir');
    assert.throws(() => archive.listEvidenceNames(), /H9C_UNSAFE_OUTPUT_DIRECTORY/);
    assert.throws(() => archive.readEvidenceBytes(filename, 4096),
      /H9C_UNSAFE_OUTPUT_DIRECTORY/);
    assert.deepEqual(readFileSync(join(decoy, filename)), decoyBytes,
      'no swapped-directory content inspected or modified');
  } finally {
    archive.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('H9C R2 inspector refuses private leaf under writable nonsticky ancestor', () => {
  const root = mkdtempSync(join(tmpdir(), 'h9c-read-parent-'));
  const untrusted = join(root, 'untrusted');
  const leaf = join(untrusted, 'private');
  mkdirSync(untrusted, { mode: 0o700 });
  mkdirSync(leaf, { mode: 0o700 });
  chmodSync(untrusted, 0o777);
  try {
    assert.throws(() => openH9CPrivateArchiveDirectory(leaf),
      /H9C_UNSAFE_OUTPUT_DIRECTORY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('H9C R2 inspector rejects symlinked evidence even with safe-looking name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h9c-read-symlink-'));
  chmodSync(dir, 0o700);
  const raw = Buffer.from('synthetic', 'utf8');
  const name = source.sourceId + '-' + sha256(raw) + '.source.html';
  const target = join(dir, 'outside.txt');
  writeFileSync(target, raw, { mode: 0o600 });
  symlinkSync(target, join(dir, name));
  const archive = openH9CPrivateArchiveDirectory(dir);
  try {
    assert.throws(() => archive.readEvidenceBytes(name, 4096),
      /H9C_UNSAFE_OUTPUT_DIRECTORY|ELOOP/);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
