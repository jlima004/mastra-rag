import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import {
  inspectH9CQuarantinedEvidence, type H9CQuarantineReceipt,
} from '../src/mastra/rag/processing/quarantine-inspection.ts';

// Offline-only: no fetch, no parser promotion, no provider request, no hosted DB.
// npm run rag:h9:inspect:operator -- /tmp/h9c-official-private
const repoRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
function reject(): never { throw new Error('H9C_INSPECTION_FAILED'); }
function privateDirectory(path: string): string {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' ||
      !isAbsolute(path)) reject();
  const canonical = realpathSync(path);
  const rel = relative(repoRoot, canonical);
  if (canonical !== resolve(path) || rel === '' ||
      (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) reject();
  const stat = lstatSync(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) reject();
  return canonical;
}
function fileBytes(path: string, maximum: number): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 ||
      stat.size <= 0 || stat.size > maximum) reject();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openStat = fstatSync(fd);
    if (openStat.ino !== stat.ino || openStat.dev !== stat.dev ||
        openStat.nlink !== 1 || openStat.size !== stat.size) reject();
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
const dirname = process.argv[2];
if (process.argv.length !== 3 || !dirname) {
  process.stderr.write('H9C_INSPECTION_USAGE_INVALID\n');
  process.exitCode = 2;
} else {
  try {
    const dir = privateDirectory(dirname);
    const entries = readdirSync(dir);
    const receipts = entries.filter(name => name.endsWith('.receipt.json'));
    const results = [];
    for (const file of receipts.sort()) {
      // Reject names and symlinks that do not match the fixed source/hash scheme.
      const match = /^(br-[a-z0-9-]+)-([0-9a-f]{64})\.receipt\.json$/.exec(file);
      if (!match || !SOURCE_MANIFEST.some(s => s.sourceId === match[1])) reject();
      const receiptBytes = fileBytes(resolve(dir, file), 16_384);
      let receipt: H9CQuarantineReceipt;
      try {
        receipt = JSON.parse(receiptBytes.toString('utf8')) as H9CQuarantineReceipt;
      } catch { reject(); }
      const rawName = match[1] + '-' + match[2] + '.source.html';
      const rawBytes = fileBytes(resolve(dir, rawName), 8 * 1024 * 1024);
      if (receipt.sourceId !== match[1] || receipt.rawSha256 !== match[2]) reject();
      results.push(inspectH9CQuarantinedEvidence(rawBytes, receipt));
    }
    process.stdout.write(JSON.stringify({
      gate: 'H9C_OPERATOR_PRIVATE_QUARANTINE_INSPECTION',
      inspectedAt: new Date().toISOString(),
      snapshotLegalAcceptance: false,
      allSourcesReviewed: false,
      sourceStatus: SOURCE_MANIFEST.map(s => {
        const found = results.filter(r => r.sourceId === s.sourceId);
        return {
          sourceId: s.sourceId,
          count: found.length,
          status: found.length ? 'quarantined-not-approved' : 'not-captured',
        };
      }),
      results,
    }, null, 2) + '\n');
  } catch {
    // File paths, raw HTTP bodies and parser exception messages stay private.
    process.stderr.write('H9C_INSPECTION_FAILED\n');
    process.exitCode = 1;
  }
}
