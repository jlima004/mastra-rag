# E1 H6 — Isolated PostgREST-equivalent security assay

**Date:** 2026-11-18. **Baseline:** master bcdab1c3fa05c09ba3f74739ee16723e82621e3a (PR #20 merged, CI/deploy successful).
**Scope:** disposable PG17 + real, separately containerized PostgREST HTTP/RPC; read-only inspection of hosted catalog; documentation-only security disposition. NO hosted SQL writes, REVOKE, ALTER, role/secret changes or provider calls in CI.

## Hosted observations (project-scoped SELECT + advisor read only)

- Project: mastra-rag / lmocjhpajhxegzobydau, PostgreSQL 17.11; hosted H6 rag_app **absent**, rag schema has no tables.
- Function: public.rls_auto_enable() owned by postgres, SECURITY DEFINER, RETURNS event_trigger, search_path pg_catalog; trigger ensure_rls at ddl_command_end remains enabled.
- Exact hosted pg_get_functiondef() SHA-256 on 2026-11-18: **b21d88816c445d14cef5032c3cd4abaebc1db2001fcb3435022ab6b496182ca4**. CI fixture reproduces the observed semantic body; it does NOT assert the PostgreSQL pretty-printed DDL bytes are identical.
- Supabase Security Advisor continues to report 2 WARNs: anon and authenticated have EXECUTE on this function in exposed public schema. The advisor text describes potential RPC reachability; that wording is NOT an HTTP execution proof.
- Original local regression in scripts/test-e1-operator-local.sh already showed direct SQL call rejection and continued event-trigger RLS behavior after a **local** REVOKE. That test was **not** a PostgREST test.

References: [anon advisor](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable); [authenticated advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Isolated HTTP experiment (new CI suite)

Run **only** bash scripts/test-e1-h6-postgrest-local.sh inside the disposable PostgreSQL 17 CI job, with E1_LOCAL_TEST_CONTAINER set by the CI job. The script refuses any other PG image/container identity, rejects ambient hosted credential variables, and creates **only a disposable local database** named rag_e1_h6_rpc. It launches the **PostgREST official Docker image postgrest/postgrest:v16.6** using a synthetic local DB password, synthetic HS256 JWT, localhost on the runner and no remote Supabase project.

1. Clone function/trigger behavior from the read-only hosted catalog definition; ensure RLS is enabled on local public.before_revocation.
2. A safe, separate security-invoker control RPC returns **current_user**. It must prove that anonymous requests run as anon and the *synthetic* JWT request runs as authenticated. This prevents treating a broken API/authentication path as evidence of denied target RPC.
3. POST /rpc/rls_auto_enable with both roles while the local function has EXECUTE, recording structured HTTP status and response error code. A successful call, unparseable error or unexpected server error **fails the CI**, rather than being declared safe.
4. In the disposable DB **only**, REVOKE EXECUTE from PUBLIC/anon/authenticated, create public.after_revocation, and assert that the ensure_rls trigger is still enabled and the new table has RLS.
5. Reload the local schema cache, revalidate both control RPC roles, and repeat the target RPC observations. Delete the disposable DB/container at exit.

**Assay limit:** version v16.6 is pinned for reproducibility but is **not demonstrated to match the deployed Supabase PostgREST version/config**. The fixture omits other hosted extensions, settings, API gateway and exposure controls. A denied isolated RPC does not establish universal exploit impossibility; a passing local REVOKE regression does not authorize production REVOKE. CI SUCCESS is only evidence for **this** fixture and transport. Independent security review must reconcile the HTTP result, production-version parity, function ownership and actual role/trigger dependencies.

## Mandatory independent review and owner decision

- [ ] Exact-HEAD CI reports local HTTP observations for both roles before/after local REVOKE, with auth control PASS.
- [ ] Independent Codex review P0/P1/P2 of the fixture, the PostgREST version, privilege setup and all CI isolation assertions.
- [ ] Human security disposition recorded separately: scoped remediation (with explicit hosted operator approval) OR documented residual risk acceptance. Neither is implicitly selected.
- [ ] Hosted warning state/role/function re-read after any **future separately approved** change; no production RPC probe for this gate.
- [ ] Future rag_app setup remains independently gated behind H6 owner/SQL/credential approval.

**State:** H6_ISOLATED_PGRST_ASSAY_DRAFT / HOSTED_SECURITY_DISPOSITION_PENDING / HOSTED_WRITES_BLOCKED.
