import { randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync,
  openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync,
  type Stats,
} from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../contracts/ids.ts';

export type ArchivePart = 'raw' | 'receipt';
export type ArchiveWriter = (fd: number, bytes: Uint8Array, part: ArchivePart) => void;

export type H9CArchiveReceipt = Readonly<{
  sourceId: string;
  rawSha256: string;
  byteSize: number;
  [field: string]: string | number | boolean | null;
}>;

const REPO_ROOT = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const BASENAME = /^br-[a-z0-9-]+-[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function unsafe(): never {
  throw new Error('H9C_UNSAFE_OUTPUT_DIRECTORY');
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/**
 * Validate ALL ancestors, not only the last path component. /tmp is allowed
 * only as root-owned sticky directory; any other group/world-writable parent
 * makes the chosen destination unsafe. Only Linux /proc/self/fd is supported.
 */
function trustedDirectoryTree(destination: string): void {
  const uid = process.getuid?.();
  if (process.platform !== 'linux' || typeof uid !== 'number' ||
      !isAbsolute(destination) || within(REPO_ROOT, destination)) unsafe();
  let current = destination;
  let leaf = true;
  for (;;) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) unsafe();
    if (leaf) {
      if (stat.uid !== uid || (stat.mode & 0o777) !== 0o700) unsafe();
    } else {
      if (stat.uid !== uid && stat.uid !== 0) unsafe();
      if ((stat.mode & 0o022) !== 0 &&
          !(stat.uid === 0 && (stat.mode & 0o1000) !== 0)) unsafe();
    }
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) break;
    current = parent;
    leaf = false;
  }
}

function sameFile(first: Stats, second: Stats): boolean {
  return first.ino === second.ino && first.dev === second.dev;
}
function unlinkCreatedOnly(path: string, original: Stats | undefined): void {
  if (!original) return;
  try {
    if (sameFile(lstatSync(path), original)) unlinkSync(path);
  } catch {
    // A failed rollback is still an error; never unlink an unrelated artifact.
  }
}

export class H9CPrivateArchiveDirectory {
  readonly #fd: number;
  readonly #destination: string;
  #closed = false;

  constructor(fd: number, destination: string) {
    this.#fd = fd;
    this.#destination = destination;
  }

  private assertStable(): void {
    if (this.#closed) unsafe();
    const byFd = realpathSync('/proc/self/fd/' + this.#fd);
    if (byFd !== this.#destination) unsafe();
    trustedDirectoryTree(byFd);
    if (!sameFile(fstatSync(this.#fd), lstatSync(this.#destination))) unsafe();
  }

  private path(name: string): string {
    return '/proc/self/fd/' + this.#fd + '/' + name;
  }

  private stage(bytes: Uint8Array, part: ArchivePart, writer: ArchiveWriter): { path: string; stat: Stats } {
    const path = this.path('.h9c-' + randomBytes(16).toString('hex') + '-' + part + '.tmp');
    let fd: number | undefined;
    let own: Stats | undefined;
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      own = fstatSync(fd);
      writer(fd, bytes, part);
      const finished = fstatSync(fd);
      if (finished.size !== bytes.byteLength || !sameFile(finished, own)) {
        throw new Error('H9C_INCOMPLETE_STAGE');
      }
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      return { path, stat: own };
    } catch {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* retain original failure */ }
      }
      unlinkCreatedOnly(path, own);
      throw new Error('H9C_ARCHIVE_FAILED');
    }
  }

  /**
   * Both names are published using hard links (link never replaces existing
   * files). Receipt is LAST and serves as the commit marker. All operations
   * are anchored to the same verified directory fd, not a re-resolved path.
   */
  publish(
    basename: string,
    raw: Uint8Array,
    receipt: H9CArchiveReceipt,
    writer: ArchiveWriter = (fd, bytes) => writeFileSync(fd, bytes),
  ): void {
    if (!BASENAME.test(basename) || !(raw instanceof Uint8Array) ||
        raw.byteLength === 0 || !receipt ||
        !SHA256.test(receipt.rawSha256) ||
        receipt.rawSha256 !== sha256(raw) ||
        receipt.byteSize !== raw.byteLength ||
        basename !== receipt.sourceId + '-' + receipt.rawSha256) {
      throw new Error('H9C_ARCHIVE_INPUT_INVALID');
    }
    this.assertStable();
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    const rawName = this.path(basename + '.source.html');
    const receiptName = this.path(basename + '.receipt.json');
    let stagedRaw: { path: string; stat: Stats } | undefined;
    let stagedReceipt: { path: string; stat: Stats } | undefined;
    let rawPublished = false;
    let receiptPublished = false;

    try {
      stagedRaw = this.stage(raw, 'raw', writer);
      stagedReceipt = this.stage(receiptBytes, 'receipt', writer);
      this.assertStable();
      linkSync(stagedRaw.path, rawName);
      rawPublished = true;
      linkSync(stagedReceipt.path, receiptName);
      receiptPublished = true;
      fsyncSync(this.#fd);
      this.assertStable();
    } catch {
      if (receiptPublished) unlinkCreatedOnly(receiptName, stagedReceipt?.stat);
      if (rawPublished) unlinkCreatedOnly(rawName, stagedRaw?.stat);
      try { fsyncSync(this.#fd); } catch { /* do not replace failure */ }
      throw new Error('H9C_ARCHIVE_FAILED');
    } finally {
      unlinkCreatedOnly(stagedReceipt?.path ?? '', stagedReceipt?.stat);
      unlinkCreatedOnly(stagedRaw?.path ?? '', stagedRaw?.stat);
    }
  }

  /**
   * Inspection uses the EXACT same validated directory handle and ancestor
   * checks as the publisher. A moved/replaced directory is never followed.
   * This is read-only and cannot be called on an untrusted arbitrary filename.
   */
  listEvidenceNames(): readonly string[] {
    this.assertStable();
    const names = readdirSync(this.path('.'));
    this.assertStable();
    return names;
  }

  readEvidenceBytes(name: string, limit: number): Buffer {
    if (typeof name !== 'string' ||
        !/^br-[a-z0-9-]+-[0-9a-f]{64}\.(?:source\.html|receipt\.json)$/.test(name) ||
        !Number.isSafeInteger(limit) || limit < 1) unsafe();
    this.assertStable();
    const candidate = this.path(name);
    const before = lstatSync(candidate);
    if (!before.isFile() || before.isSymbolicLink() ||
        before.uid !== process.getuid?.() ||
        (before.mode & 0o777) !== 0o600 || before.nlink !== 1 ||
        before.size < 1 || before.size > limit) unsafe();
    let fileFd: number | undefined;
    try {
      fileFd = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW |
        constants.O_NONBLOCK);
      const opened = fstatSync(fileFd);
      if (!opened.isFile() || !sameFile(before, opened) ||
          opened.uid !== before.uid || (opened.mode & 0o777) !== 0o600 ||
          opened.nlink !== 1 || opened.size < 1 || opened.size > limit) unsafe();
      const bytes = readFileSync(fileFd);
      const after = fstatSync(fileFd);
      if (!sameFile(opened, after) || after.size !== opened.size ||
          bytes.byteLength !== opened.size || after.nlink !== 1) unsafe();
      this.assertStable();
      return bytes;
    } finally {
      if (fileFd !== undefined) closeSync(fileFd);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    closeSync(this.#fd);
  }
}

/**
 * Caller MUST hold this directory handle through the remote fetch and both
 * artifact writes. The directory may be moved, but /proc/self/fd pins writes
 * to the originally validated inode; a moved path is rejected on publication.
 */
export function openH9CPrivateArchiveDirectory(destination: string): H9CPrivateArchiveDirectory {
  if (typeof destination !== 'string' || !isAbsolute(destination)) unsafe();
  const target = resolve(destination);
  if (realpathSync(target) !== target) unsafe();
  trustedDirectoryTree(target);
  let fd: number | undefined;
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_DIRECTORY |
      constants.O_NOFOLLOW);
    const pinned = realpathSync('/proc/self/fd/' + fd);
    if (pinned !== target || !sameFile(fstatSync(fd), lstatSync(target))) unsafe();
    trustedDirectoryTree(pinned);
    return new H9CPrivateArchiveDirectory(fd, target);
  } catch {
    if (fd !== undefined) closeSync(fd);
    unsafe();
  }
}
