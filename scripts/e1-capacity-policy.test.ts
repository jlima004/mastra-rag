import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessE1H10Capacity,
  E1_H10_LIMITS,
  type E1CapacitySnapshot,
  type E1CapacityProjection,
} from './e1-capacity-policy.ts';

const MiB = 1_048_576;
function snapshot(overrides: Partial<E1CapacitySnapshot> = {}): E1CapacitySnapshot {
  return {
    activeVectors: 100,
    additionalSpaces: 0,
    ragBytes: 10 * MiB,
    databaseBytes: 20 * MiB,
    organizationBytes: 30_000_000,
    organizationUsageVerified: true,
    diskUsedBytes: 50 * MiB,
    diskTotalBytes: 2 * 1024 * MiB,
    walBytes: 1 * MiB,
    physicalDiskVerified: true,
    ...overrides,
  };
}
function projection(overrides: Partial<E1CapacityProjection> = {}): E1CapacityProjection {
  return {
    newActiveVectors: 1,
    newAdditionalSpaces: 0,
    ragAdditionalBytes: 1 * MiB,
    databaseAdditionalBytes: 1 * MiB,
    organizationAdditionalBytes: 1 * MiB,
    physicalDiskAdditionalBytes: 2 * MiB,
    ...overrides,
  };
}
const evaluate = (
  s: Partial<E1CapacitySnapshot> = {},
  p: Partial<E1CapacityProjection> = {},
) => assessE1H10Capacity(snapshot(s), projection(p));

test('ordinary bounded projected job passes pure capacity computation', () => {
  const s = snapshot(), p = projection();
  const r = assessE1H10Capacity(s, p);
  assert.equal(r.admitted, true);
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.projected?.activeVectors, 101);
  assert.deepEqual(s, snapshot()); // pure, not a database reservation
  assert.deepEqual(p, projection());
});

test('ratified vector cap is inclusive and rejects projected row 2001', () => {
  assert.equal(evaluate({ activeVectors: 1999 }, { newActiveVectors: 1 }).admitted, true);
  assert.ok(evaluate({ activeVectors: 1999 }, { newActiveVectors: 2 }).blocks.includes('H10_ACTIVE_VECTOR_CAP'));
});
test('ratified at-most-one rebuilding space rejects second additional space', () => {
  assert.equal(evaluate({ additionalSpaces: 1 }, { newAdditionalSpaces: 0 }).admitted, true);
  assert.ok(evaluate({ additionalSpaces: 1 }, { newAdditionalSpaces: 1 }).blocks.includes('H10_EXTRA_SPACE_CAP'));
});
test('rag warnings and hard stop follow binary MiB exactly', () => {
  assert.ok(evaluate({ ragBytes: 80 * MiB }, { ragAdditionalBytes: 0 }).warnings.includes('H10_RAG_WARNING'));
  assert.equal(evaluate({ ragBytes: 100 * MiB - 1 }, { ragAdditionalBytes: 0 }).admitted, true);
  assert.ok(evaluate({ ragBytes: 100 * MiB }, { ragAdditionalBytes: 0 }).blocks.includes('H10_RAG_HARD_STOP'));
});
test('project warnings and hard stop follow binary MiB exactly', () => {
  assert.ok(evaluate({ databaseBytes: 250 * MiB, organizationBytes: 280_000_000 }, { databaseAdditionalBytes: 0, organizationAdditionalBytes: 0 }).warnings.includes('H10_PROJECT_WARNING'));
  assert.equal(evaluate({ databaseBytes: 300 * MiB - 1, organizationBytes: 320_000_000 }, { databaseAdditionalBytes: 0, organizationAdditionalBytes: 0 }).admitted, true);
  assert.ok(evaluate({ databaseBytes: 300 * MiB, organizationBytes: 330_000_000 }, { databaseAdditionalBytes: 0, organizationAdditionalBytes: 0 }).blocks.includes('H10_PROJECT_HARD_STOP'));
});
test('organization aggregate warning and hard stop use decimal MB, not binary', () => {
  assert.equal(E1_H10_LIMITS.organizationHardBytes, 400_000_000);
  assert.ok(evaluate({ organizationBytes: 350_000_000 }, { organizationAdditionalBytes: 0, databaseAdditionalBytes: 0 }).warnings.includes('H10_ORGANIZATION_WARNING'));
  assert.equal(evaluate({ organizationBytes: 399_999_999 }, { organizationAdditionalBytes: 0, databaseAdditionalBytes: 0 }).admitted, true);
  assert.ok(evaluate({ organizationBytes: 400_000_000 }, { organizationAdditionalBytes: 0, databaseAdditionalBytes: 0 }).blocks.includes('H10_ORGANIZATION_HARD_STOP'));
});
test('org aggregate unavailable blocks, even when project is small', () => {
  assert.ok(evaluate({ organizationBytes: null }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
  assert.ok(evaluate({ organizationUsageVerified: false }).blocks.includes('H10_ORGANIZATION_NOT_VERIFIED'));
});
test('physical disk and WAL telemetry are mandatory, independent of project size', () => {
  assert.ok(evaluate({ diskUsedBytes: null }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
  assert.ok(evaluate({ diskTotalBytes: null }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
  assert.ok(evaluate({ walBytes: null }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
  assert.ok(evaluate({ physicalDiskVerified: false }).blocks.includes('H10_PHYSICAL_DISK_NOT_VERIFIED'));
});
test('projected physical disk reaching 95% blocks new work conservatively', () => {
  const s = { diskTotalBytes: 100 * MiB, diskUsedBytes: 94 * MiB };
  assert.equal(evaluate(s, { physicalDiskAdditionalBytes: 0 }).admitted, true);
  assert.ok(evaluate(s, { physicalDiskAdditionalBytes: 1 * MiB }).blocks.includes('H10_DISK_CRITICAL'));
});
test('invalid disk measurements block rather than divide by zero', () => {
  assert.ok(evaluate({ diskTotalBytes: 0 }).blocks.includes('H10_PHYSICAL_DISK_INVALID'));
  assert.ok(evaluate({ diskUsedBytes: 200 * MiB, diskTotalBytes: 100 * MiB }).blocks.includes('H10_PHYSICAL_DISK_INVALID'));
});
test('organization sum cannot be less than one included project', () => {
  assert.ok(evaluate({ organizationBytes: 2_000_000 }).blocks.includes('H10_ORGANIZATION_AGGREGATE_INCONSISTENT'));
});
test('P2 regression: growth in rag cannot be omitted from project and org projections', () => {
  const s = snapshot({
    databaseBytes: 299 * MiB,
    organizationBytes: 399_000_000,
    diskUsedBytes: 380 * MiB,
  });
  const inconsistent = projection({
    newActiveVectors: 0,
    ragAdditionalBytes: 2 * MiB,
    databaseAdditionalBytes: 0,
    organizationAdditionalBytes: 0,
    physicalDiskAdditionalBytes: 2 * MiB,
  });
  const rejected = assessE1H10Capacity(s, inconsistent);
  assert.equal(rejected.admitted, false);
  assert.ok(rejected.blocks.includes('H10_PROJECT_DELTA_UNDERESTIMATED'));

  const accounted = assessE1H10Capacity(s, {
    ...inconsistent,
    databaseAdditionalBytes: 2 * MiB,
    organizationAdditionalBytes: 2 * MiB,
  });
  assert.equal(accounted.admitted, false);
  assert.ok(accounted.blocks.includes('H10_PROJECT_HARD_STOP'));
  assert.ok(accounted.blocks.includes('H10_ORGANIZATION_HARD_STOP'));
});

test('rag relation snapshot cannot exceed enclosing project database size', () => {
  const result = evaluate({
    ragBytes: 60 * MiB,
    databaseBytes: 50 * MiB,
    organizationBytes: 100_000_000,
  });
  assert.equal(result.admitted, false);
  assert.ok(result.blocks.includes('H10_PROJECT_SNAPSHOT_UNDERCOUNTS_RAG'));
});

test('an undercounted organization projection is rejected', () => {
  assert.ok(evaluate({}, { organizationAdditionalBytes: 0 }).blocks.includes('H10_ORGANIZATION_DELTA_UNDERESTIMATED'));
});
test('negative and fractional projections never become negative capacity credit', () => {
  assert.ok(evaluate({}, { newActiveVectors: -1 }).blocks.includes('H10_PROJECTION_MISSING_OR_INVALID'));
  assert.ok(evaluate({}, { ragAdditionalBytes: 0.5 }).blocks.includes('H10_PROJECTION_MISSING_OR_INVALID'));
});
test('negative, NaN and unsafe measurements fail closed', () => {
  assert.ok(evaluate({ ragBytes: -1 }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
  assert.ok(evaluate({ databaseBytes: Number.NaN }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
  assert.ok(evaluate({ organizationBytes: Number.MAX_VALUE }).blocks.includes('H10_METRICS_MISSING_OR_INVALID'));
});
test('integer overflow is rejected before cap comparisons', () => {
  assert.ok(evaluate({ diskTotalBytes: Number.MAX_SAFE_INTEGER, diskUsedBytes: Number.MAX_SAFE_INTEGER - 10 }, { physicalDiskAdditionalBytes: 100 }).blocks.includes('H10_PROJECTION_OVERFLOW'));
});
test('missing projection or snapshot does not throw and blocks', () => {
  assert.equal(assessE1H10Capacity(null as unknown as E1CapacitySnapshot, projection()).admitted, false);
  assert.equal(assessE1H10Capacity(snapshot(), null as unknown as E1CapacityProjection).admitted, false);
});
test('multiple simultaneous violated caps are reported, never partially admitted', () => {
  const r = evaluate(
    { activeVectors: 2_000, ragBytes: 100 * MiB, databaseBytes: 300 * MiB, organizationBytes: 400_000_000 },
    { newActiveVectors: 1, ragAdditionalBytes: 0, databaseAdditionalBytes: 0, organizationAdditionalBytes: 0 },
  );
  assert.equal(r.admitted, false);
  assert.ok(r.blocks.includes('H10_ACTIVE_VECTOR_CAP'));
  assert.ok(r.blocks.includes('H10_RAG_HARD_STOP'));
  assert.ok(r.blocks.includes('H10_PROJECT_HARD_STOP'));
  assert.ok(r.blocks.includes('H10_ORGANIZATION_HARD_STOP'));
});
