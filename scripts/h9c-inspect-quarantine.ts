import { SOURCE_MANIFEST } from '../src/mastra/rag/contracts/manifest.ts';
import { openH9CPrivateArchiveDirectory } from '../src/mastra/rag/processing/private-archive.ts';
import {
  inspectH9CQuarantinedEvidence, type H9CQuarantineReceipt,
  type H9CQuarantineInspection,
} from '../src/mastra/rag/processing/quarantine-inspection.ts';

// Offline-only. Reuse the archive's trusted-ancestor policy and a single
// directory descriptor for enumeration AND both file reads. No HTML logging.
// npm run rag:h9:inspect:operator -- /tmp/h9c-official-private
function reject(): never { throw new Error('H9C_INSPECTION_FAILED'); }
const destination = process.argv[2];

if (process.argv.length !== 3 || !destination) {
  process.stderr.write('H9C_INSPECTION_USAGE_INVALID\n');
  process.exitCode = 2;
} else {
  let archive: ReturnType<typeof openH9CPrivateArchiveDirectory> | undefined;
  try {
    archive = openH9CPrivateArchiveDirectory(destination);
    const entries = archive.listEvidenceNames();
    const receipts = entries.filter(name => name.endsWith('.receipt.json'));
    // A raw file without a committed receipt is incomplete evidence.
    for (const file of entries.filter(name => name.endsWith('.source.html'))) {
      const receiptName = file.slice(0, -'.source.html'.length) + '.receipt.json';
      if (!entries.includes(receiptName)) reject();
    }
    const results: H9CQuarantineInspection[] = [];
    for (const file of receipts.sort()) {
      const match = /^(br-[a-z0-9-]+)-([0-9a-f]{64})\.receipt\.json$/.exec(file);
      if (!match || !SOURCE_MANIFEST.some(s => s.sourceId === match[1])) reject();
      const receiptBytes = archive.readEvidenceBytes(file, 16_384);
      let receipt: H9CQuarantineReceipt;
      try {
        receipt = JSON.parse(receiptBytes.toString('utf8')) as H9CQuarantineReceipt;
      } catch { reject(); }
      const rawName = match[1] + '-' + match[2] + '.source.html';
      const rawBytes = archive.readEvidenceBytes(rawName, 8 * 1024 * 1024);
      if (receipt.sourceId !== match[1] || receipt.rawSha256 !== match[2]) reject();
      results.push(inspectH9CQuarantinedEvidence(rawBytes, receipt));
    }
    // Detect a directory swap even after the last file read.
    archive.listEvidenceNames();
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
    // Never expose raw HTML, file paths, receipt contents, or driver errors.
    process.stderr.write('H9C_INSPECTION_FAILED\n');
    process.exitCode = 1;
  } finally {
    archive?.close();
  }
}
