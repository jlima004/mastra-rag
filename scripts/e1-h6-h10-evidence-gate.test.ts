import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessE1H6H10Evidence } from './e1-h6-h10-evidence-gate.ts';

const at = '2026-11-18T16:00:00Z';
const within = '2026-11-18T15:30:00Z';
const full = () => ({
  projectRef: 'lmocjhpajhxegzobydau',
  organizationId: 'bciquteonwtxyyerveik',
  projectDatabaseBytes: 11_228_851,
  h6: {
    roleExists: false,
    securityAdvisorNames: [
      'anon_security_definer_function_executable',
      'authenticated_security_definer_function_executable',
    ],
    advisorsObservedAt: within,
    isolatedEquivalentReviewRef: 'synthetic-isolated-review',
    ownerSecurityDispositionRef: 'synthetic-human-decision',
  },
  h10: {
    organization: {
      aggregateBytes: 30_000_000,
      projectCount: 3,
      includesInactiveProjects: true,
      source: 'SUPABASE_ORGANIZATION_USAGE',
      observedAt: within,
    },
    physical: {
      diskUsedBytes: 100_000_000,
      diskTotalBytes: 2_000_000_000,
      walBytes: 1_000_000,
      source: 'SUPABASE_PHYSICAL_DISK_WAL',
      observedAt: within,
    },
    representativeCorpusEvidenceRef: 'synthetic-corpus-report',
    concurrentAdmissionEvidenceRef: 'synthetic-concurrency-report',
  },
});

const audit = (x: unknown, age = 24) => assessE1H6H10Evidence(x, at, age);
test('synthetic complete evidence is reviewable but never authorizes remote writes or E2', () => {
  const x = full();
  assert.deepEqual(audit(x), {
    evidenceReadyForHumanReview: true,
    blockers: [],
    hostedWritesAuthorized: false,
    e2IngestionAuthorized: false,
  });
  assert.deepEqual(x, full());
});

test('current real-world unknown org/disk and pending H6 decisions fail closed', () => {
  const x = full();
  x.h6.isolatedEquivalentReviewRef = null as unknown as string;
  x.h6.ownerSecurityDispositionRef = null as unknown as string;
  x.h10.organization = null as unknown as typeof x.h10.organization;
  x.h10.physical = null as unknown as typeof x.h10.physical;
  x.h10.concurrentAdmissionEvidenceRef = null as unknown as string;
  const r = audit(x);
  assert.equal(r.evidenceReadyForHumanReview, false);
  assert.equal(r.hostedWritesAuthorized, false);
  for (const code of [
    'H6_ISOLATED_SECURITY_REVIEW_PENDING', 'H6_HUMAN_SECURITY_DISPOSITION_PENDING',
    'H10_ORGANIZATION_USAGE_UNVERIFIED_OR_HARD_STOP',
    'H10_PHYSICAL_DISK_WAL_UNVERIFIED_OR_CRITICAL', 'H10_CONCURRENT_ADMISSION_PENDING',
  ]) assert.ok(r.blockers.includes(code));
});

test('unexpected target and role state are blocked', () => {
  const x = full();
  x.projectRef = 'other-project';
  x.h6.roleExists = true;
  const r = audit(x);
  assert.ok(r.blockers.includes('E1_EVIDENCE_TARGET_MISMATCH'));
  assert.ok(r.blockers.includes('H6_ROLE_BASELINE_UNEXPECTED'));
});

test('advisor drift, missing independent review and stale timestamps block', () => {
  const x = full();
  x.h6.securityAdvisorNames = ['anon_security_definer_function_executable'];
  x.h6.advisorsObservedAt = '2026-11-16T12:00:00Z';
  x.h6.isolatedEquivalentReviewRef = '';
  const r = audit(x);
  assert.ok(r.blockers.includes('H6_SECURITY_ADVISOR_SNAPSHOT_MISSING_STALE_OR_DRIFTED'));
  assert.ok(r.blockers.includes('H6_ISOLATED_SECURITY_REVIEW_PENDING'));
});

test('project-only values cannot masquerade as org telemetry', () => {
  const x = full();
  x.h10.organization.source = 'pg_database_size';
  x.h10.organization.includesInactiveProjects = false;
  const r = audit(x);
  assert.ok(r.blockers.includes('H10_ORGANIZATION_USAGE_UNVERIFIED_OR_HARD_STOP'));
});

test('inconsistent or over-limit org data blocks', () => {
  const x = full();
  x.h10.organization.aggregateBytes = 1;
  assert.ok(audit(x).blockers.includes('H10_ORGANIZATION_USAGE_UNVERIFIED_OR_HARD_STOP'));
  x.h10.organization.aggregateBytes = 400_000_000;
  assert.ok(audit(x).blockers.includes('H10_ORGANIZATION_USAGE_UNVERIFIED_OR_HARD_STOP'));
});

test('missing WAL, critical disk or wrong source blocks', () => {
  const x = full();
  x.h10.physical.walBytes = null as unknown as number;
  assert.ok(audit(x).blockers.includes('H10_PHYSICAL_DISK_WAL_UNVERIFIED_OR_CRITICAL'));
  x.h10.physical.walBytes = 1_000_000;
  x.h10.physical.diskUsedBytes = 1_900_000_000;
  assert.ok(audit(x).blockers.includes('H10_PHYSICAL_DISK_WAL_UNVERIFIED_OR_CRITICAL'));
  x.h10.physical.diskUsedBytes = 100_000_000;
  x.h10.physical.source = 'pg_database_size';
  assert.ok(audit(x).blockers.includes('H10_PHYSICAL_DISK_WAL_UNVERIFIED_OR_CRITICAL'));
});

test('future or stale provider observations are never silently accepted', () => {
  const x = full();
  x.h10.organization.observedAt = '2026-11-19T00:00:00Z';
  x.h10.physical.observedAt = '2026-11-17T00:00:00Z';
  const r = audit(x);
  assert.ok(r.blockers.includes('H10_ORGANIZATION_USAGE_UNVERIFIED_OR_HARD_STOP'));
  assert.ok(r.blockers.includes('H10_PHYSICAL_DISK_WAL_UNVERIFIED_OR_CRITICAL'));
});

test('invalid envelopes or review windows cannot cause a green gate', () => {
  for (const x of [null, undefined, [], 'ready']) assert.equal(audit(x).evidenceReadyForHumanReview, false);
  assert.equal(assessE1H6H10Evidence(full(), 'bad', 24).evidenceReadyForHumanReview, false);
  assert.equal(audit(full(), 0).evidenceReadyForHumanReview, false);
});

test('missing concurrency or corpus proof blocks even with numeric capacity headroom', () => {
  const x = full();
  x.h10.concurrentAdmissionEvidenceRef = null as unknown as string;
  x.h10.representativeCorpusEvidenceRef = null as unknown as string;
  const r = audit(x);
  assert.ok(r.blockers.includes('H10_CONCURRENT_ADMISSION_PENDING'));
  assert.ok(r.blockers.includes('H10_CORPUS_FOOTPRINT_PENDING'));
  assert.equal(r.e2IngestionAuthorized, false);
});
