# E1 H6 — `rag_app` provisioning (operator gate preparation)

**Date:** 2026-11-18. **Baseline:** `master` `daacf964cd53b701b918e5a37d3805eb72e709b6` (PR #23 merged/deployed, H6-S1 complete). **Target:** Supabase project `mastra-rag` / `lmocjhpajhxegzobydau` in organization `Alquem.io` (**Free**).

**Authority:** H6-D1 [minimal application role contract](../decisions/RAG-E1-H5-H6-H10-owner-ratification.md) and [current MVP overrides](../decisions/RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md). This PR is **operator preparation only**. The previous PM recommendation explicitly proposed a Draft PR **without immediate hosted provisioning**. Neither opening nor merging this PR authorizes hosting `CREATE ROLE`, `GRANT`, `\password`, database connection configuration, migration push or ingest.

## 1. Fresh remote preflight — read-only (2026-11-18)

Selected provider project by **actual project ref**, not `current_database() = 'postgres'`. Supabase project is `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.019; organization `Alquem.io` confirmed `plan=free` / `tier=tier_free`. Security Advisor returned **zero findings** after the independently authorized H6-S1 privilege revocation.

A project-scoped SELECT-only catalog snapshot found:

| Requirement before creating role | Value | Gate |
| --- | --- | --- |
| Operator | `current_user=postgres`; `rolcreaterole=true` | PASS |
| Password encryption | `scram-sha-256` | PASS |
| Role `rag_app` | Not present | PASS |
| Schemas | Private `rag` and `extensions` exist; `vector` installed in `extensions` | PASS |
| Private catalog | `rag` has 0 tables | PASS |
| H5 history | Foundation `20261113233720` present; catalog `20261117213614` absent | PASS |
| Private schema access | `anon`, `authenticated` and `service_role` have no `rag` USAGE | PASS |
| H6-S1 | `anon`/`authenticated` cannot EXECUTE `public.rls_auto_enable()` | PASS |

The exact reusable query is [read-only preflight](../../db/readonly/e1_h6_rag_app_preflight.sql); re-run it **only after distinct authorization** and compare **every** value to this matrix. Provider project identity and Free tier require **separate provider checks**, never SQL-derived inference. Stop on any drift.

## 2. Two distinct future owner approvals

**Gate H6-R1: role creation + minimal schema grant.** Operator performs the reviewed [candidate SQL](../../db/operator/e1_h6_rag_app_pre_catalog_candidate.sql) on the verified project only, after fresh human approval. It is a **transactional, fail-closed** creation of `rag_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL` with **only** `GRANT USAGE ON SCHEMA extensions TO rag_app`. `PASSWORD NULL` makes the role unusable for password login until provisioned separately, rather than exposing a password in SQL/logs or CI. No `CREATE` on any schema, no ownership, memberships, RLS bypass or application grants. No role is created by this Draft.

**Gate H6-R2: interactive credential provisioning.** Requires a **separate owner approval for a protected live session** and an owner-generated strong unique secret, stored in an approved secret manager, never entered in chat, PR, `.env` committed to Git, SQL, GitHub Actions or shell history. Use an authenticated and TLS-protected PostgreSQL client session to the verified target. In **interactive psql** (not `psql -c`, SQL Editor or `PASSWORD '...'`):

```text
\password rag_app
```

The psql client prompts privately and forms a SCRAM verifier client-side; **do not log the command's generated verifier or claim that the platform necessarily redacts it**. Verify password authentication through a protected operator-controlled test that logs **success/failure only**, not DSN/password, before any runtime DSN provisioning. If any uncertainty about provider logging or verifier exposure remains, stop and adjudicate securely; never fall back to inline SQL containing a secret. An operator session to the Supabase database itself may require an independently protected PostgreSQL administrator credential; this PR does not collect or create one.

**Do not automatically proceed from H6-R1 to H6-R2.** In particular, neither stage authorizes production runtime database configuration or ingestion. If role creation succeeds but credential provisioning is blocked, keep password login disabled and record a limited intermediate state, without destructive cleanup/retry.

## 3. Pre-catalog postflight

Run [read-only postflight](../../db/readonly/e1_h6_rag_app_postflight.sql) on the exact target after a future separately approved role creation. Require:

- Exactly one `rag_app`, `LOGIN=true`, `NOINHERIT`, non-superuser, no `CREATEROLE`, `CREATEDB`, `REPLICATION` or `BYPASSRLS`.
- No privileged memberships, schema/relation ownership, `CREATE` on `rag`, `extensions`, `public`; no `rag` USAGE before the approved catalog migration.
- Exactly `USAGE` on `extensions`. No public Data API schema exposure, no `postgres`/`service_role` runtime identity.
- Verify that the H6-S1 function/trigger/hash has not drifted and read Supabase Security Advisor again. These checks are intentionally **read-only**; password validity is a separate protected operational test.
- **No silent reruns:** the candidate detects an already existing role and stops. If any postcondition fails, halt and request owner adjudication; no blind drop, re-GRANT, rollback or extra DDL.

## 4. Dedicated disposable CI

`scripts/test-e1-rag-app-provision-local.sh` runs only against its **own** `pgvector/pgvector:pg17` service database `rag_e1_role`, not the separate catalog fixture. It reproduces the minimal private foundation, executes exactly the proposed SQL **locally**, verifies postflight grants/flags, proves private DDL denial and rejects accidental replays. No supplied Supabase credentials, hosted SQL, `supabase db push`, app runtime wiring or paid provider calls. Passing CI does **not** prove Supabase-hosted role creation, password login or dependency compatibility.

## 5. Explicit exclusions

- No hosted role/credential actions, SQL migrations, vector table/index, seed data, project/organization upgrades, DSN changes, public route or E2 ingestion.
- H10 **CANCELED** for Free-tier MVP; do not reintroduce organization/disk/WAL measurements or the historic internal capacity quotas. Provider-enforced Free restrictions remain.
- `NO_BACKUP_MVP` unchanged; no real backup or restore test.
- H5 catalog migration, vector space, H7 access, H11 model spend, H12 retention/GC and E2 require their own distinct approvals.

**State:** `E1_H6_RAG_APP_PREPARATION_DRAFT / ROLE_ABSENT / HOSTED_ROLE_CREATION_NOT_AUTHORIZED / H10_CANCELED_FREE_MVP`.
