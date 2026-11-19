/**
 * E1 R1 disposable PG17 regression SQL (never execute against hosted Supabase).
 * Invoked only by scripts/test-e1-local.sh after its fixed Docker target guard.
 * Uses the two SQL predicates imported directly from runtime production code.
 */
import {
  RUNTIME_VECTOR_TYPE_CONTRACT_SQL as typeContract,
  RUNTIME_VECTOR_POLICIES_CONTRACT_SQL as policyContract,
} from '../src/mastra/storage/supabase-runtime-probe.ts';

const sql: string[] = [
  '-- E1 R1: disposable PG17 only, no hosted project or remote credentials',
  'BEGIN;',
  'SET LOCAL search_path TO public;',
  `DO $r1_type$ BEGIN
    IF (SELECT format_type(a.atttypid,a.atttypmod)
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='rag.chunks_te3s_1536_v1'::regclass
          AND a.attname='embedding') = 'vector(1536)' THEN
      RAISE EXCEPTION 'E1_R1_P1_FIXTURE_DID_NOT_HIDE_EXTENSIONS';
    END IF;
    IF NOT (${typeContract}) THEN
      RAISE EXCEPTION 'E1_R1_P1_TYPE_IDENTITY_WRONGLY_DEPENDS_ON_SEARCH_PATH';
    END IF;
  END $r1_type$;`,
  `DO $r1_base$ BEGIN
    IF NOT (${policyContract}) THEN
      RAISE EXCEPTION 'E1_R1_P2_BASELINE_APPROVED_POLICY_REJECTED';
    END IF;
  END $r1_base$;`,
];

const cases = [
  {
    label: 'select_not_equal',
    command: `ALTER POLICY rag_vector_select ON rag.chunks_te3s_1536_v1
      USING (namespace <> 'public');`,
  },
  {
    label: 'select_or_true',
    command: `ALTER POLICY rag_vector_select ON rag.chunks_te3s_1536_v1
      USING (namespace = 'public' OR true);`,
  },
  {
    label: 'insert_check_or_true',
    command: `ALTER POLICY rag_vector_insert ON rag.chunks_te3s_1536_v1
      WITH CHECK (namespace = 'public' OR true);`,
  },
  {
    label: 'update_using_or_true',
    command: `ALTER POLICY rag_vector_update ON rag.chunks_te3s_1536_v1
      USING (namespace = 'public' OR true)
      WITH CHECK (namespace = 'public');`,
  },
  {
    label: 'update_check_or_true',
    command: `ALTER POLICY rag_vector_update ON rag.chunks_te3s_1536_v1
      USING (namespace = 'public')
      WITH CHECK (namespace = 'public' OR true);`,
  },
];

for (const { label, command } of cases) {
  sql.push('SAVEPOINT e1_r1_policy_drift;');
  sql.push(command);
  sql.push(`DO $r1_negative$ BEGIN
    IF (${policyContract}) THEN
      RAISE EXCEPTION 'E1_R1_P2_UNSAFE_POLICY_ACCEPTED_${label}';
    END IF;
  END $r1_negative$;`);
  sql.push('ROLLBACK TO SAVEPOINT e1_r1_policy_drift;');
}

sql.push(`DO $r1_final$ BEGIN
  IF NOT (${policyContract}) THEN
    RAISE EXCEPTION 'E1_R1_P2_BASELINE_NOT_RESTORED';
  END IF;
END $r1_final$;`);
sql.push('ROLLBACK;');
sql.push("\\echo 'E1_RUNTIME_PROBE_R1_P1_P2_PG17_REGRESSIONS_PASS'");
process.stdout.write(sql.join('\n') + '\n');
