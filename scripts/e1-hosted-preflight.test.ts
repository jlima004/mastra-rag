import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateHostedPreflight } from './e1-hosted-preflight.ts';

const expected = () => ({
  database_name: 'postgres',
  pg_major: 17,
  database_bytes: 11_228_851,
  rag_schema_exists: true,
  rag_table_count: 0,
  rag_relation_bytes: 0,
  rag_app_exists: false,
  vector_version: '0.8.2',
  vector_schema: 'extensions',
  anon_rag_usage: false,
  authenticated_rag_usage: false,
  service_role_rag_usage: false,
  migration_versions: ['20261113233720'],
  foundation_sql_sha256: '9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13',
  foundation_statement_count: 1,
  rls_auto_enable_security_definer: true,
  rls_auto_enable_returns_event_trigger: true,
  anon_function_execute: true,
  authenticated_function_execute: true,
  ensure_rls_event_trigger_active: true,
});

test('read-only verified baseline matches, but never authorizes a hosted write', () => {
  const x=expected();
  const decision=evaluateHostedPreflight(x);
  assert.equal(decision.consistent,true);
  assert.equal(decision.remoteWritesAuthorized,false);
  assert.ok(decision.observations.includes('E1_ORGANIZATION_USAGE_UNMEASURED'));
  assert.ok(decision.observations.includes('E1_SECURITY_RISK_DISPOSITION_PENDING'));
  assert.deepEqual(x,expected());
});
test('invalid or missing results fail closed', () => {
  for(const value of [undefined,null,{},[],true,'{}']) {
    assert.equal(evaluateHostedPreflight(value).consistent,false);
    assert.equal(evaluateHostedPreflight(value).remoteWritesAuthorized,false);
  }
});
test('unexpected additional migration or foundation checksum drift fail closed', () => {
  assert.ok(evaluateHostedPreflight({...expected(),migration_versions:['20261113233720','20261117213614']}).blockers.includes('E1_HOSTED_MIGRATION_DRIFT'));
  assert.ok(evaluateHostedPreflight({...expected(),foundation_sql_sha256:'wrong'}).blockers.includes('E1_HOSTED_MIGRATION_DRIFT'));
  assert.ok(evaluateHostedPreflight({...expected(),foundation_statement_count:2}).blockers.includes('E1_HOSTED_MIGRATION_DRIFT'));
});
test('unexpected role or data state fails closed', () => {
  assert.ok(evaluateHostedPreflight({...expected(),rag_app_exists:true}).blockers.includes('E1_UNEXPECTED_HOSTED_CATALOG_OR_ROLE_STATE'));
  assert.ok(evaluateHostedPreflight({...expected(),rag_table_count:1}).blockers.includes('E1_UNEXPECTED_HOSTED_CATALOG_OR_ROLE_STATE'));
  assert.ok(evaluateHostedPreflight({...expected(),rag_relation_bytes:512}).blockers.includes('E1_UNEXPECTED_HOSTED_CATALOG_OR_ROLE_STATE'));
});
test('public grants and extension drift fail closed', () => {
  assert.ok(evaluateHostedPreflight({...expected(),anon_rag_usage:true}).blockers.includes('E1_PRIVATE_SCHEMA_EXPOSURE'));
  assert.ok(evaluateHostedPreflight({...expected(),service_role_rag_usage:true}).blockers.includes('E1_PRIVATE_SCHEMA_EXPOSURE'));
  assert.ok(evaluateHostedPreflight({...expected(),vector_schema:'public'}).blockers.includes('E1_VECTOR_EXTENSION_DRIFT'));
});
test('wrong target and hard-stop threshold fail closed', () => {
  assert.ok(evaluateHostedPreflight({...expected(),database_name:'other'}).blockers.includes('E1_TARGET_DATABASE_IDENTITY_MISMATCH'));
  assert.ok(evaluateHostedPreflight({...expected(),pg_major:16}).blockers.includes('E1_TARGET_DATABASE_IDENTITY_MISMATCH'));
  assert.ok(evaluateHostedPreflight({...expected(),database_bytes:300*1_048_576}).blockers.includes('E1_DATABASE_SIZE_INVALID_OR_HARD_STOP'));
  assert.ok(evaluateHostedPreflight({...expected(),database_bytes:Number.NaN}).blockers.includes('E1_DATABASE_SIZE_INVALID_OR_HARD_STOP'));
});
test('security WARN changes force re-adjudication and never authorize remote changes', () => {
  const x=evaluateHostedPreflight({...expected(),anon_function_execute:false});
  assert.ok(x.blockers.includes('E1_EXISTING_SECURITY_ADVISOR_STATE_CHANGED'));
  assert.equal(x.remoteWritesAuthorized,false);
});
