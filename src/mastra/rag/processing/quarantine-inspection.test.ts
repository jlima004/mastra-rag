import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../contracts/ids.ts';
import { SOURCE_MANIFEST } from '../contracts/manifest.ts';
import {
  inspectH9CQuarantinedEvidence, type H9CQuarantineReceipt,
} from './quarantine-inspection.ts';

const source = SOURCE_MANIFEST.find(s => s.sourceId === 'br-anpd-res-15-2024')!;
function fixture(input: string, extractionStatus: 'unsupported' | 'unreviewed-parsed' = 'unsupported') {
  const raw = Buffer.from(input, 'utf8');
  const sha = sha256(raw);
  const receipt: H9CQuarantineReceipt = {
    evidenceClass: 'operator-readonly-acquisition-quarantined',
    sourceId: source.sourceId,
    canonicalUri: source.canonicalUri,
    finalUri: source.canonicalUri,
    status: 200,
    mediaType: 'text/html',
    charset: 'utf-8',
    byteSize: raw.byteLength,
    rawSha256: sha,
    extractionStatus,
    extractionErrorCode: extractionStatus === 'unsupported' ? 'EXTRACT_UNSUPPORTED_HTML' : null,
    evidenceFileBasename: source.sourceId + '-' + sha + '.source.html',
    officialLegalTextAccepted: false,
    snapshotSemanticallyReviewed: false,
    paidAdmissionApproved: false,
  };
  return { raw, receipt };
}

test('H9C receipt inspector verifies bytes and emits hints without leaking HTML/title', () => {
  const { raw, receipt } = fixture(
    '<!doctype html><html><head><title>Segredo sintético para teste</title><meta charset="utf-8"></head>' +
    '<body>RESOLUÇÃO CD/ANPD Nº 15, Art. 1º Texto jurídico inventado.</body></html>');
  const result = inspectH9CQuarantinedEvidence(raw, receipt);
  assert.equal(result.receiptIntegrityVerified, true);
  assert.equal(result.diagnosticFlags.htmlTagObserved, true);
  assert.equal(result.diagnosticFlags.titleTagObserved, true);
  assert.equal(result.diagnosticFlags.legalArticleMarkerObserved, true);
  assert.equal(result.diagnosticFlags.legalResolutionMarkerObserved, true);
  assert.equal(result.diagnosticFlags.metaCharsetDeclared, true);
  assert.equal(result.diagnosticFlags.possibleAccessChallengeObserved, false);
  assert.equal(result.officialLegalTextAccepted, false);
  assert.equal(result.snapshotSemanticallyReviewed, false);
  assert.equal(result.paidAdmissionApproved, false);
  assert.equal(result.documentClassification, 'unreviewed-requires-human-inspection');
  assert.equal(JSON.stringify(result).includes('Segredo sintético'), false);
  assert.equal(JSON.stringify(result).includes(source.canonicalUri), false);
});

test('H9C inspector detects possible challenge, never calls it official law', () => {
  const { raw, receipt } = fixture(
    '<!doctype html><html><head><title>Access Denied</title></head>' +
    '<body>CAPTCHA required for bot verification</body></html>');
  const result = inspectH9CQuarantinedEvidence(raw, receipt);
  assert.equal(result.diagnosticFlags.possibleAccessChallengeObserved, true);
  assert.equal(result.diagnosticFlags.legalArticleMarkerObserved, false);
  assert.equal(result.officialLegalTextAccepted, false);
});

test('H9C inspector rejects tampering, source substitution, and false acceptance', () => {
  const { raw, receipt } = fixture('<!doctype html><html><p>Art. 1º Texto fictício.</p></html>');
  const bad = [
    { ...receipt, rawSha256: 'a'.repeat(64) },
    { ...receipt, sourceId: 'br-anpd-res-18-2024' },
    { ...receipt, canonicalUri: 'https://example.org/pretend-act' },
    { ...receipt, finalUri: 'https://example.org/pretend-act' },
    { ...receipt, byteSize: 1 },
    { ...receipt, status: 404 },
    { ...receipt, extractionStatus: 'other' },
    { ...receipt, officialLegalTextAccepted: true },
    { ...receipt, snapshotSemanticallyReviewed: true },
    { ...receipt, paidAdmissionApproved: true },
    { ...receipt, evidenceClass: 'official-validated' },
  ];
  for (const altered of bad) {
    assert.throws(() => inspectH9CQuarantinedEvidence(raw, altered as H9CQuarantineReceipt),
      /H9C_INSPECTION_INVALID_EVIDENCE/);
  }
  assert.throws(() => inspectH9CQuarantinedEvidence(Buffer.concat([raw, Buffer.from('x')]), receipt),
    /H9C_INSPECTION_INVALID_EVIDENCE/);
});

test('H9C inspection retains parser unsupported status without pretending extraction', () => {
  const { raw, receipt } = fixture('<html><body><div>Texto sintético.</div></body></html>');
  const result = inspectH9CQuarantinedEvidence(raw, receipt);
  assert.equal(result.extractionStatus, 'unsupported');
  assert.equal(result.extractorCode, 'EXTRACT_UNSUPPORTED_HTML');
  assert.equal(result.documentClassification, 'unreviewed-requires-human-inspection');
});
