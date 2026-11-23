import { constants } from 'node:fs';
import {
  lstatSync, realpathSync, openSync, closeSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import { sha256 } from '../src/mastra/rag/contracts/ids.ts';
import { fetchApprovedSourceById } from '../src/mastra/rag/processing/fetch.ts';
import { decodeFetchedDocument } from '../src/mastra/rag/processing/decode.ts';
import { extractHtmlBlocks, extractTextBlocks } from '../src/mastra/rag/processing/html.ts';
import { normalizeLegalBlocks } from '../src/mastra/rag/processing/legal.ts';

// Operator-initiated ONLY. Not wired to CI, build, hosted routes or a timer.
// Invocation: node --experimental-strip-types scripts/h9c-fetch-operator.ts
//  <manifest-source-id> <ABSOLUTE_EXISTING_PRIVATE_OUTPUT_DIRECTORY>
const sourceId = process.argv[2];
const out = process.argv[3];
const source = SOURCE_MANIFEST.find(s => s.sourceId === sourceId);
if (process.argv.length !== 4 || !source || !out || !isAbsolute(out)) {
  process.stderr.write('H9C_OPERATOR_USAGE_INVALID\n');
  process.exitCode = 2;
} else {
  try {
    // Deny repository paths, symlink directories and permissive destinations.
    const requested = resolve(out);
    const stat = lstatSync(requested);
    const canonical = realpathSync(requested);
    const repoDir = realpathSync(process.cwd());
    const rel = relative(repoDir, canonical);
    if (!stat.isDirectory() || stat.isSymbolicLink() || requested !== canonical ||
        rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)) ||
        (stat.mode & 0o077) !== 0) {
      throw new Error('UNSAFE_OUTPUT_DIRECTORY');
    }
    const fetched = await fetchApprovedSourceById(sourceId);
    const decoded = decodeFetchedDocument(fetched, source);
    const raw = fetched.sniffedMediaType === 'text/html'
      ? extractHtmlBlocks(decoded) : extractTextBlocks(decoded, fetched.sniffedMediaType);
    const normalized = normalizeLegalBlocks(raw, source);
    const basename = source.sourceId + '-' + fetched.contentSha256;
    const archivePath = join(canonical, basename + '.source.html');
    const receiptPath = join(canonical, basename + '.receipt.json');
    // create-exclusive; never overwrite frozen raw content or alter source files.
    const fd = openSync(archivePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeFileSync(fd, fetched.bytes); }
    finally { closeSync(fd); }
    const receipt = Object.freeze({
      evidenceClass: 'operator-readonly-acquisition-not-approved-corpus',
      sourceId: source.sourceId,
      canonicalUri: source.canonicalUri,
      finalUri: fetched.finalUri,
      status: fetched.httpStatus,
      mediaType: fetched.sniffedMediaType,
      declaredMediaType: fetched.declaredMediaType,
      charset: fetched.charset,
      fetchedAt: fetched.fetchedAt,
      byteSize: fetched.byteSize,
      rawSha256: fetched.contentSha256,
      decodedSha256: sha256(decoded),
      normalizedSha256: normalized.normalizedSha256,
      extractor: source.extractor,
      blocks: normalized.blocks.length,
      evidenceFileBasename: basename + '.source.html',
      officialLegalTextAccepted: false,
      snapshotSemanticallyReviewed: false,
      paidAdmissionApproved: false,
    });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({
      status: 'H9C_OPERATOR_BYTES_ARCHIVED_UNREVIEWED',
      sourceId, rawSha256: fetched.contentSha256,
      normalizedSha256: normalized.normalizedSha256,
      byteSize: fetched.byteSize,
      officialLegalTextAccepted: false,
    }) + '\n');
  } catch (error) {
    // Never expose raw responses, source text, filesystem exceptions or URLs.
    const code = error && typeof error === 'object' &&
      'code' in error && typeof error.code === 'string' &&
      /^[A-Z_]+$/.test(error.code) ? error.code : 'H9C_ACQUISITION_FAILED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}
