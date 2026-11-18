# E1 H6-R1 — Hosted `rag_app` creation execution receipt

**Date:** 2026-11-18. **Authorization:** owner explicitly requested *“Execute `E1_H6_R1_HOSTED_ROLE_CREATION`.”* This is the distinct hosted-execution approval required after [PR #24](https://github.com/jlima004/mastra-rag/pull/24) merged and deployed. **Outcome:** `H6_R1_HOSTED_ROLE_CREATED_VERIFIED`.

## Authority, scope and immutable code reference

- Source of the executed SQL: **unchanged**, reviewed and merged `db/operator/e1_h6_rag_app_pre_catalog_candidate.sql`, baseline `master` `904731f49e49ef7278d7d3ff0f31a19ba019947c` (PR #24 candidate `f677065da187aa0cab7d4a6e1ecbb80cbbc67b45`). That source contains `BEGIN; DO ...; COMMIT;` with guarded creation and inline checks. It is not a Supabase migration.
- Exact hosted project selected by the Supabase provider tool: `mastra-rag`, ref `lmocjhpajhxegzobydau`, organization `Alquem.io` / `bciquteonwtxyyerveik`, region `sa-east-1`, project `ACTIVE_HEALTHY`, PostgreSQL **17.11**, plan **Free** (`plan=free`, `tier=tier_free`). This identity was **not** inferred from SQL's database name `postgres`.
- Authorized mutation was limited to: `CREATE ROLE rag_app WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL`; followed by `GRANT USAGE ON SCHEMA extensions TO rag_app`. **Nothing else was created, granted, changed or deployed as part of the hosted SQL.**
- No password, DSN, secret manager change, `rag` catalog migration, vector space creation, ingestion or paid provider call was authorized or executed in this gate.

## Fresh hosted preflight: PASS

Ran the **unchanged** `db/readonly/e1_h6_rag_app_preflight.sql` from exact merged baseline via project-scoped Supabase SQL, with provider identity and Free subscription verified separately:

| Test | Observed |
| --- | --- |
| `current_user`, `rolcreaterole` | `postgres`, `true` |
| PostgreSQL / `password_encryption` | 17, `scram-sha-256` |
| `rag_app` absent | `true` |
| `rag`, `extensions`, vector in extensions | present |
| `rag` catalog table count | 0 |
| Foundation ledger `20261113233720` | applied |
| Catalog ledger `20261117213614` | **not applied** |
| `anon`/`authenticated`/`service_role` USAGE in `rag` | none |
| `anon`/`authenticated` EXECUTE for H6-S1 function | revoked |
| PUBLIC `CREATE` on `public`, `rag`, `extensions` | none, verified with a further SELECT-only ACL check |

Supabase Security Advisor read **before** execution returned `lints=[]`.

## Hosted execution: SUCCESS

Ran **the exact reviewed SQL** from PR #24 once via the project-specific Supabase SQL tool. The SQL ran inside `BEGIN; ... COMMIT;` and enforced role absence, extension/schema presence, PG17/SCRAM config and minimum role/grant flags. The command completed successfully and returned no result rows. It did **not** run `\password`, alter H5 migration history or create catalog tables. The candidate is intentionally non-idempotent; **do not rerun** or attempt automatic repair.

## Independent hosted postflight: PASS

Reran **unchanged** `db/readonly/e1_h6_rag_app_postflight.sql` from the same reviewed baseline as a separate Supabase SELECT after execution:

| Key | Observed |
| --- | --- |
| `role_count` | **1** |
| `flags_minimal` | **true** (`LOGIN`/ `NOINHERIT`, without superuser, createdb, createrole, replication, bypassrls) |
| `membership_count` | **0** |
| `owns_schema` | **0** |
| `owns_rag_relations` | **0** |
| `extensions_usage` | **true** |
| `extensions_create` | **false** |
| `rag_usage_before_catalog` | **false** |
| `rag_create` | **false** |
| `public_create` | **false** |
| `catalog_table_count` | **0** |

The independent provider project recheck still reported `ACTIVE_HEALTHY` and PostgreSQL 17.11. The official Supabase Security Advisor **after execution** returned `lints=[]`. These are snapshot observations; a passing advisor does not prove universal production security.

**Credential boundary:** The executed SQL explicitly specified `PASSWORD NULL`. Neither password authentication nor an independent password-verifier inspection was performed (the postflight purposely does not read `pg_authid`). Do not treat `LOGIN` as proof that the role is usable. In normal password-based operation the account is **not ready** until separately approved H6-R2.

## Next gated operations

- **H6-R1:** `COMPLETE / HOSTED VERIFIED`. Do not recreate `rag_app`, reapply the SQL or grant `rag` privileges yet.
- **H6-R2:** `PENDING HUMAN AUTHORIZATION` for an interactive protected PostgreSQL session, strong unique secret and `\password rag_app` with secret custody and an authentication-only proof. Never paste a password, verifier, DSN or key into chat/PR/CI. No automatic H6-R2 following role creation.
- **H5 catalog:** `PENDING`, requires ledger-conformant approved migration and separate authority.
- Vector space, operator publication, runtime DSN, H7/H11/H12 and **E2 live ingestion** remain independent gates.
- **H10 canceled** for the Free MVP; **NO_BACKUP_MVP** unchanged. No organizational/physical capacity measurements, paid plan, backup, or inactive-project restoration introduced.

**Status:** `E1_H6_R1_HOSTED_ROLE_CREATED_VERIFIED / H6_R2_CREDENTIAL_PENDING / H5_CATALOG_PENDING / H10_CANCELLED_FREE_MVP`.

**This evidence-only PR does not execute or authorize additional hosted actions.**
