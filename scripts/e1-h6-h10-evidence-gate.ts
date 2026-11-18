/**
 * HISTORICAL ONLY (2026-11-18): owner canceled H10 telemetry as an MVP gate.
 * This prior H6/H10 evidence envelope targets the pre-H6-S1 state and may not
 * be used as a present-day security or E2 admission gate. Pure offline history.
 * E1 H6/H10 evidence-envelope gate. Pure, offline and advisory-only.
 * Never reads provider credentials, executes SQL, calls Supabase, or authorizes writes.
 * A syntactically complete envelope is NOT proof of independent verification.
 */
export type H6H10Evidence = {
  projectRef: string;
  organizationId: string;
  projectDatabaseBytes: number;
  h6: {
    roleExists: boolean;
    securityAdvisorNames: string[];
    advisorsObservedAt: string;
    isolatedEquivalentReviewRef: string | null;
    ownerSecurityDispositionRef: string | null;
  };
  h10: {
    organization: {
      aggregateBytes: number;
      projectCount: number;
      includesInactiveProjects: boolean;
      source: string;
      observedAt: string;
    } | null;
    physical: {
      diskUsedBytes: number;
      diskTotalBytes: number;
      walBytes: number;
      source: string;
      observedAt: string;
    } | null;
    representativeCorpusEvidenceRef: string | null;
    concurrentAdmissionEvidenceRef: string | null;
  };
};

export type H6H10EvidenceDecision = Readonly<{
  evidenceReadyForHumanReview: boolean;
  blockers: readonly string[];
  hostedWritesAuthorized: false;
  e2IngestionAuthorized: false;
}>;

const EXPECTED_ADVISORS = [
  'anon_security_definer_function_executable',
  'authenticated_security_definer_function_executable',
];
const TARGET_PROJECT = 'lmocjhpajhxegzobydau';
const TARGET_ORGANIZATION = 'bciquteonwtxyyerveik';
const PROJECT_HARD_BYTES = 300 * 1_048_576;
const ORGANIZATION_HARD_BYTES = 400_000_000;
const PHYSICAL_CRITICAL_RATIO = 0.95;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const unsigned = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const reference = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

function fresh(value: unknown, asOf: number, ageMs: number): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) return false;
  const seen = Date.parse(value);
  return Number.isFinite(seen) && seen <= asOf && asOf - seen <= ageMs;
}

/**
 * maxAgeHours is supplied by the reviewer, not a newly ratified SLO.
 * Passing references/source strings are claims requiring independent inspection.
 */
export function assessE1H6H10Evidence(
  value: unknown,
  asOfIso: string,
  maxAgeHours: number,
): H6H10EvidenceDecision {
  const blockers: string[] = [];
  const asOf = Date.parse(asOfIso);
  if (!Number.isFinite(asOf) || typeof asOfIso !== 'string' ||
      !Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 168) {
    return {
      evidenceReadyForHumanReview: false,
      blockers: ['E1_EVIDENCE_REVIEW_WINDOW_INVALID'],
      hostedWritesAuthorized: false,
      e2IngestionAuthorized: false,
    };
  }

  const input = record(value);
  if (!input) {
    return {
      evidenceReadyForHumanReview: false,
      blockers: ['E1_EVIDENCE_ENVELOPE_INVALID'],
      hostedWritesAuthorized: false,
      e2IngestionAuthorized: false,
    };
  }
  const h6 = record(input.h6);
  const h10 = record(input.h10);
  const ageMs = maxAgeHours * 60 * 60 * 1000;

  if (input.projectRef !== TARGET_PROJECT || input.organizationId !== TARGET_ORGANIZATION) {
    blockers.push('E1_EVIDENCE_TARGET_MISMATCH');
  }
  if (!unsigned(input.projectDatabaseBytes) || input.projectDatabaseBytes >= PROJECT_HARD_BYTES) {
    blockers.push('H10_PROJECT_METER_MISSING_OR_HARD_STOP');
  }

  if (!h6 || h6.roleExists !== false) blockers.push('H6_ROLE_BASELINE_UNEXPECTED');
  const names = h6?.securityAdvisorNames;
  if (!Array.isArray(names) || names.length !== EXPECTED_ADVISORS.length ||
      !EXPECTED_ADVISORS.every((name) => names.includes(name)) ||
      !fresh(h6?.advisorsObservedAt, asOf, ageMs)) {
    blockers.push('H6_SECURITY_ADVISOR_SNAPSHOT_MISSING_STALE_OR_DRIFTED');
  }
  if (!reference(h6?.isolatedEquivalentReviewRef)) {
    blockers.push('H6_ISOLATED_SECURITY_REVIEW_PENDING');
  }
  if (!reference(h6?.ownerSecurityDispositionRef)) {
    blockers.push('H6_HUMAN_SECURITY_DISPOSITION_PENDING');
  }

  const org = record(h10?.organization);
  if (!org || org.source !== 'SUPABASE_ORGANIZATION_USAGE' ||
      !unsigned(org.aggregateBytes) || org.aggregateBytes >= ORGANIZATION_HARD_BYTES ||
      !unsigned(org.projectCount) || org.projectCount < 1 ||
      org.includesInactiveProjects !== true ||
      !fresh(org.observedAt, asOf, ageMs) ||
      (unsigned(input.projectDatabaseBytes) && unsigned(org.aggregateBytes) &&
       org.aggregateBytes < input.projectDatabaseBytes)) {
    blockers.push('H10_ORGANIZATION_USAGE_UNVERIFIED_OR_HARD_STOP');
  }

  const physical = record(h10?.physical);
  if (!physical || physical.source !== 'SUPABASE_PHYSICAL_DISK_WAL' ||
      !unsigned(physical.diskUsedBytes) || !unsigned(physical.diskTotalBytes) ||
      !unsigned(physical.walBytes) || physical.diskTotalBytes === 0 ||
      (unsigned(physical.diskUsedBytes) && unsigned(physical.diskTotalBytes) &&
        (physical.diskUsedBytes > physical.diskTotalBytes ||
         physical.diskUsedBytes >= physical.diskTotalBytes * PHYSICAL_CRITICAL_RATIO)) ||
      !fresh(physical.observedAt, asOf, ageMs)) {
    blockers.push('H10_PHYSICAL_DISK_WAL_UNVERIFIED_OR_CRITICAL');
  }

  if (!reference(h10?.representativeCorpusEvidenceRef)) blockers.push('H10_CORPUS_FOOTPRINT_PENDING');
  if (!reference(h10?.concurrentAdmissionEvidenceRef)) blockers.push('H10_CONCURRENT_ADMISSION_PENDING');

  return {
    evidenceReadyForHumanReview: blockers.length === 0,
    blockers,
    hostedWritesAuthorized: false,
    e2IngestionAuthorized: false,
  };
}
