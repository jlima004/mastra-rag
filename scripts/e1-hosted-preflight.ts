/**
 * E1 hosted preflight evidence gate. Pure validation; NEVER grants authority
 * to mutate a real database or replays a migration.
 *
 * Input is the single JSON object returned by
 * db/readonly/e1_hosted_baseline_preflight.sql.  There is intentionally no
 * network client, environment/secret reader, DDL or remote CLI invocation.
 */
const EXPECTED_FOUNDATION_SHA256 =
  '9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13';
const EXPECTED_APPLIED_VERSIONS = ['20261113233720'];
const PROJECT_DB_HARD_STOP_BYTES = 300 * 1_048_576;

export type HostedPreflightDecision = Readonly<{
  consistent: boolean;
  blockers: readonly string[];
  observations: readonly string[];
  remoteWritesAuthorized: false;
}>;

export function evaluateHostedPreflight(value: unknown): HostedPreflightDecision {
  const blockers: string[] = [];
  const observations: string[] = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      consistent: false,
      blockers: ['E1_HOSTED_PREFLIGHT_INVALID'],
      observations,
      remoteWritesAuthorized: false,
    };
  }
  const x = value as Record<string, unknown>;
  if (x.database_name !== 'postgres' || x.pg_major !== 17) {
    blockers.push('E1_TARGET_DATABASE_IDENTITY_MISMATCH');
  }
  if (x.rag_schema_exists !== true ||
      x.rag_table_count !== 0 ||
      x.rag_relation_bytes !== 0 ||
      x.rag_app_exists !== false) {
    blockers.push('E1_UNEXPECTED_HOSTED_CATALOG_OR_ROLE_STATE');
  }
  if (x.vector_schema !== 'extensions' || x.vector_version !== '0.8.2') {
    blockers.push('E1_VECTOR_EXTENSION_DRIFT');
  }
  if (x.anon_rag_usage !== false ||
      x.authenticated_rag_usage !== false ||
      x.service_role_rag_usage !== false) {
    blockers.push('E1_PRIVATE_SCHEMA_EXPOSURE');
  }
  const migrationVersions = x.migration_versions;
  if (!Array.isArray(migrationVersions) ||
      migrationVersions.length !== EXPECTED_APPLIED_VERSIONS.length ||
      !EXPECTED_APPLIED_VERSIONS.every((v, i) => migrationVersions[i] === v) ||
      x.foundation_sql_sha256 !== EXPECTED_FOUNDATION_SHA256 ||
      x.foundation_statement_count !== 1) {
    blockers.push('E1_HOSTED_MIGRATION_DRIFT');
  }
  if (!Number.isSafeInteger(x.database_bytes) ||
      typeof x.database_bytes !== 'number' ||
      x.database_bytes <= 0 ||
      x.database_bytes >= PROJECT_DB_HARD_STOP_BYTES) {
    blockers.push('E1_DATABASE_SIZE_INVALID_OR_HARD_STOP');
  }
  if (x.rls_auto_enable_security_definer !== true ||
      x.rls_auto_enable_returns_event_trigger !== true ||
      x.ensure_rls_event_trigger_active !== true ||
      x.anon_function_execute !== true ||
      x.authenticated_function_execute !== true) {
    blockers.push('E1_EXISTING_SECURITY_ADVISOR_STATE_CHANGED');
  } else {
    observations.push('E1_TWO_EXISTING_SECURITY_WARNINGS_UNRESOLVED');
  }

  // These are independent from consistent/true: this gate cannot authorize.
  observations.push('E1_ORGANIZATION_USAGE_UNMEASURED');
  observations.push('E1_PHYSICAL_DISK_WAL_UNMEASURED');
  observations.push('E1_SUPABASE_CLI_REMOTE_HISTORY_UNVERIFIED');
  observations.push('E1_SECURITY_RISK_DISPOSITION_PENDING');
  observations.push('E1_ROLE_CATALOG_SPACE_DSN_ACTIONS_NOT_AUTHORIZED');
  return {
    consistent: blockers.length === 0,
    blockers,
    observations,
    remoteWritesAuthorized: false,
  };
}
