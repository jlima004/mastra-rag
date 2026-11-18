# E1/H6 — Restricted EXECUTE operator decision package (not executable authority)

> **EXECUTED AND VERIFIED (2026-11-18):** Owner specifically authorized the scoped H6-S1 revocation, which was executed once on the confirmed hosted project. A postflight catalog read found only `postgres` and `service_role` EXECUTE grants; zero Supabase security advisor findings. The proposed SQL and preconditions below are **historical and MUST NOT be rerun** as part of this documentation gate. See [execution record](../decisions/RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md).

**Date:** 2026-11-18. **Owner decision:** PENDING (proposed H6-S1). **Scope:** exact-target, operator-owned, future gated SQL only. This page is NOT a runbook authorizing the current assistant or CI to mutate Supabase.

## Target and read-only preflight

Project `mastra-rag`, ref `lmocjhpajhxegzobydau`, PostgreSQL 17; organization `Alquem.io`. Ensure the target is selected out of band via the official Supabase project identity, not inferred from `current_database()='postgres'` (many Supabase projects have that DB name).

Run **only if separately authorized**, the metadata-only `db/readonly/e1_h6_security_adjudication_preflight.sql`. Reconcile its result manually with [the H6 decision record](../decisions/RAG-E1-H6-security-adjudication.md): exactly one expected function, owner postgres, `SECURITY DEFINER`, `RETURNS event_trigger`, expected pg_get_functiondef checksum, exact `PUBLIC`/`anon`/`authenticated` grants, `service_role` grant preserved, correct search path and active `ensure_rls` event trigger. Require the **same observed version/config state** before any privileged action. If any value differs, stop and adjudicate drift; don't guess the corrective SQL.

## Proposed narrow SQL change — **DO NOT EXECUTE WITHOUT SECOND HUMAN AUTHORIZATION**

The precise candidate is **one** PostgreSQL privileges statement:

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
```

No `ALTER FUNCTION`, `DROP`, `ALTER EVENT TRIGGER`, `SECURITY INVOKER`, `CASCADE` or schema exposure change is in scope. The procedure should be performed only by an authorized operator using a reviewed transactional session and independently verified project target. Do not embed host credentials in commands, SQL, PRs, CI or chat.

## Proposed postconditions (future approval only)

1. `has_function_privilege('anon', function_oid, 'EXECUTE') = false`; likewise for `authenticated`. Confirm `PUBLIC` `EXECUTE` not present in the resulting ACL.
2. Function definition checksum, owner, return type and `SECURITY DEFINER` remain unchanged; `ensure_rls` still `O` / `ddl_command_end` with the three expected DDL tags.
3. Explicit `postgres` and `service_role` `EXECUTE` remain as before (not a blanket removal).
4. Repeat official Supabase Security Advisor reads. **Do not guarantee WARN closure** in advance; re-open the gate if advisor findings persist or new ones appear.
5. If any inconsistency occurs, **stop**: no silent re-GRANT, destructive rollback, automatic retry or extra role changes. Capture a redacted audit report for a new owner decision. `NO_BACKUP_MVP` remains unchanged.

**What this plan cannot prove:** current provider PostgREST release/gateway parity; undocumented client dependencies; availability of exact external project version telemetry. No hosted RPC probe has been authorized. None of those uncertainties should be disguised as green evidence.

## Authority boundaries

- [x] H6 local event-trigger and HTTP evidence in PR #21, final CI #44346464821.
- [x] Metadata and current ACL re-read without database mutation.
- [ ] New adjudication PR exact-HEAD CI, independent Codex review, human merge/deploy approval.
- [ ] Distinct owner **H6-S1 vs H6-S2** ratification.
- [ ] After H6-S1, distinct human approval for the exact hosted `REVOKE` and independent post-change validation.
- [ ] `rag_app`/catalog/space/DSN/embedding/E2 permissions separately approved. H10 metrics remain unknown.

**State:** `H6_S1_OPERATOR_PLAN_DOCUMENTED / OWNER_DECISION_PENDING / HOSTED_WRITES_NOT_AUTHORIZED`.
