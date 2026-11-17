/**
 * E1 H10: pure, offline capacity-admission candidate. Never queries Supabase,
 * executes SQL, calls a model or grants runtime permission to ingest.
 *
 * Future E2 must supply verified org-wide + disk/WAL telemetry, account for
 * outstanding concurrent reservations under a database lock, and enforce
 * this outcome before any persistent write. A standalone PASS is not that gate.
 */

export const E1_H10_LIMITS = Object.freeze({
  activeVectors: 2_000,
  additionalSpaces: 1,
  ragWarningBytes: 80 * 1_048_576,
  ragHardBytes: 100 * 1_048_576,
  databaseWarningBytes: 250 * 1_048_576,
  databaseHardBytes: 300 * 1_048_576,
  organizationWarningBytes: 350_000_000,
  organizationHardBytes: 400_000_000,
  physicalDiskCriticalFraction: 0.95,
});

export interface E1CapacitySnapshot {
  activeVectors: number;
  additionalSpaces: number;
  ragBytes: number;
  databaseBytes: number;
  organizationBytes: number | null;
  organizationUsageVerified: boolean;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  walBytes: number | null;
  physicalDiskVerified: boolean;
}

export interface E1CapacityProjection {
  newActiveVectors: number;
  newAdditionalSpaces: number;
  ragAdditionalBytes: number;
  databaseAdditionalBytes: number;
  organizationAdditionalBytes: number;
  physicalDiskAdditionalBytes: number;
}

export interface E1CapacityDecision {
  admitted: boolean;
  blocks: string[];
  warnings: string[];
  projected: Readonly<{
    activeVectors: number;
    additionalSpaces: number;
    ragBytes: number;
    databaseBytes: number;
    organizationBytes: number;
    diskUsedBytes: number;
  }> | null;
}

const validInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function addChecked(a: number, b: number): number | null {
  const total = a + b;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

export function assessE1H10Capacity(
  snapshot: E1CapacitySnapshot,
  projection: E1CapacityProjection,
): E1CapacityDecision {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const snapshotMetrics = [
    snapshot?.activeVectors,
    snapshot?.additionalSpaces,
    snapshot?.ragBytes,
    snapshot?.databaseBytes,
    snapshot?.organizationBytes,
    snapshot?.diskUsedBytes,
    snapshot?.diskTotalBytes,
    snapshot?.walBytes,
  ];
  const projectionMetrics = [
    projection?.newActiveVectors,
    projection?.newAdditionalSpaces,
    projection?.ragAdditionalBytes,
    projection?.databaseAdditionalBytes,
    projection?.organizationAdditionalBytes,
    projection?.physicalDiskAdditionalBytes,
  ];
  if (!snapshot || snapshotMetrics.some((value) => !validInteger(value))) {
    blocks.push('H10_METRICS_MISSING_OR_INVALID');
  }
  if (!projection || projectionMetrics.some((value) => !validInteger(value))) {
    blocks.push('H10_PROJECTION_MISSING_OR_INVALID');
  }
  if (snapshot?.organizationUsageVerified !== true) {
    blocks.push('H10_ORGANIZATION_NOT_VERIFIED');
  }
  if (snapshot?.physicalDiskVerified !== true) {
    blocks.push('H10_PHYSICAL_DISK_NOT_VERIFIED');
  }
  if (blocks.length > 0) {
    return { admitted: false, blocks, warnings, projected: null };
  }

  // All numeric inputs are validated above. Never silently round, clamp or
  // assume that the per-project DB measurement is the organization-wide sum.
  const s = snapshot;
  const d = projection;
  if (s.diskTotalBytes! === 0 || s.diskUsedBytes! > s.diskTotalBytes!) {
    blocks.push('H10_PHYSICAL_DISK_INVALID');
  }
  if (s.organizationBytes! < s.databaseBytes) {
    blocks.push('H10_ORGANIZATION_AGGREGATE_INCONSISTENT');
  }
  if (d.organizationAdditionalBytes < d.databaseAdditionalBytes) {
    blocks.push('H10_ORGANIZATION_DELTA_UNDERESTIMATED');
  }

  const totals = [
    addChecked(s.activeVectors, d.newActiveVectors),
    addChecked(s.additionalSpaces, d.newAdditionalSpaces),
    addChecked(s.ragBytes, d.ragAdditionalBytes),
    addChecked(s.databaseBytes, d.databaseAdditionalBytes),
    addChecked(s.organizationBytes!, d.organizationAdditionalBytes),
    addChecked(s.diskUsedBytes!, d.physicalDiskAdditionalBytes),
  ];
  if (totals.some((total) => total === null) || blocks.length > 0) {
    if (totals.some((total) => total === null)) {
      blocks.push('H10_PROJECTION_OVERFLOW');
    }
    return { admitted: false, blocks, warnings, projected: null };
  }

  const [activeVectors, additionalSpaces, ragBytes, databaseBytes, organizationBytes, diskUsedBytes] =
    totals as number[];
  if (activeVectors > E1_H10_LIMITS.activeVectors) blocks.push('H10_ACTIVE_VECTOR_CAP');
  if (additionalSpaces > E1_H10_LIMITS.additionalSpaces) blocks.push('H10_EXTRA_SPACE_CAP');
  if (ragBytes >= E1_H10_LIMITS.ragHardBytes) blocks.push('H10_RAG_HARD_STOP');
  if (databaseBytes >= E1_H10_LIMITS.databaseHardBytes) blocks.push('H10_PROJECT_HARD_STOP');
  if (organizationBytes >= E1_H10_LIMITS.organizationHardBytes) blocks.push('H10_ORGANIZATION_HARD_STOP');
  if (diskUsedBytes >= s.diskTotalBytes! * E1_H10_LIMITS.physicalDiskCriticalFraction) {
    blocks.push('H10_DISK_CRITICAL');
  }

  if (ragBytes >= E1_H10_LIMITS.ragWarningBytes) warnings.push('H10_RAG_WARNING');
  if (databaseBytes >= E1_H10_LIMITS.databaseWarningBytes) warnings.push('H10_PROJECT_WARNING');
  if (organizationBytes >= E1_H10_LIMITS.organizationWarningBytes) warnings.push('H10_ORGANIZATION_WARNING');

  return {
    admitted: blocks.length === 0,
    blocks,
    warnings,
    projected: {
      activeVectors,
      additionalSpaces,
      ragBytes,
      databaseBytes,
      organizationBytes,
      diskUsedBytes,
    },
  };
}
