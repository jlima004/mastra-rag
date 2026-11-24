import { isAbsolute } from 'node:path';
import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import { fetchApprovedSourceById } from '../src/mastra/rag/processing/fetch.ts';
import { openH9CPrivateArchiveDirectory } from '../src/mastra/rag/processing/private-archive.ts';
import { assessH9CQuarantinedResponse } from '../src/mastra/rag/processing/source-quarantine.ts';

// Explicit operator command ONLY; never scheduled, deployed, or invoked in CI.
// No host/path allowlist expansion, HTML rewriting, CAPTCHA or access bypass.
// npm run rag:h9:acquire:operator -- <manifest-id> <existing private absolute dir>
const sourceId = process.argv[2];
const destination = process.argv[3];
const source = SOURCE_MANIFEST.find(item => item.sourceId === sourceId);

if (process.argv.length !== 4 || !source || typeof destination !== 'string' ||
    !isAbsolute(destination)) {
  process.stderr.write('H9C_OPERATOR_USAGE_INVALID\n');
  process.exitCode = 2;
} else {
  let archive: ReturnType<typeof openH9CPrivateArchiveDirectory> | undefined;
  try {
    // Anchor the handle BEFORE the asynchronous fetch to prevent path swaps.
    archive = openH9CPrivateArchiveDirectory(destination);
    const fetched = await fetchApprovedSourceById(sourceId);
    // Never promote a 200/HTML response to legal-source acceptance by itself.
    // Unsupported real portal HTML is kept raw with a "quarantined" receipt.
    const assessment = assessH9CQuarantinedResponse(fetched, source);
    const basename = source.sourceId + '-' + fetched.contentSha256;
    const receipt = Object.freeze({
      evidenceClass: 'operator-readonly-acquisition-quarantined',
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
      decodedSha256: assessment.decodedSha256,
      normalizedSha256: assessment.normalizedSha256,
      extractor: source.extractor,
      extractionStatus: assessment.extractionStatus,
      extractionErrorCode: assessment.extractionErrorCode,
      blocks: assessment.normalizedBlocks,
      evidenceFileBasename: basename + '.source.html',
      officialLegalTextAccepted: false,
      snapshotSemanticallyReviewed: false,
      paidAdmissionApproved: false,
    });
    archive.publish(basename, fetched.bytes, receipt);
    process.stdout.write(JSON.stringify({
      status: 'H9C_OPERATOR_BYTES_QUARANTINED_UNREVIEWED',
      sourceId,
      rawSha256: fetched.contentSha256,
      normalizedSha256: assessment.normalizedSha256,
      byteSize: fetched.byteSize,
      extractionStatus: assessment.extractionStatus,
      extractionErrorCode: assessment.extractionErrorCode,
      officialLegalTextAccepted: false,
    }) + '\n');
  } catch (error) {
    // No source text, raw exceptions, URL, credential or filesystem path.
    const code = error && typeof error === 'object' &&
      'code' in error && typeof error.code === 'string' &&
      /^[A-Z_]+$/.test(error.code) ? error.code
      : error instanceof Error && /^H9C_[A-Z_]+$/.test(error.message)
        ? error.message : 'H9C_ACQUISITION_FAILED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  } finally {
    archive?.close();
  }
}
