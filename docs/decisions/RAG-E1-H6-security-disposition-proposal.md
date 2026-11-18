# RAG-E1 H6 — Security disposition proposal (not owner-ratified)

**Date:** 2026-11-18. **Status:** PROPOSED / NO_HOSTED_SECURITY_CHANGE_AUTHORIZED. Superseding authority: [H5/H6/H10 owner ratification](RAG-E1-H5-H6-H10-owner-ratification.md). The two existing Security Advisor WARNs have NOT been accepted or remediated.

## Finding and evidence standard

The hosted catalog shows public.rls_auto_enable() is an event-trigger function (SECURITY DEFINER, owner postgres), with EXECUTE effective for anon/authenticated, and linked to ensure_rls. Security Advisor reports both public/signed-in execution warnings. These are confirmed properties, not a demonstrated successful HTTP RPC invocation or verified privilege-escalation path.

The disposable PG17 + PostgREST HTTP test [assay](../rag/e1-h6-postgrest-isolated-assay.md) is an independent reproduction proposal. Evaluate **the exact result** on the final reviewed commit, not an assumption about event-trigger RPC support. Function definition SHA-256 from hosted read-only catalog: b21d88816c445d14cef5032c3cd4abaebc1db2001fcb3435022ab6b496182ca4.

## Decisions to present to the owner AFTER independent review

**Option H6-S1 — targeted privilege restriction (candidate, no execution authority):**
If isolated HTTP behavior, event-trigger regression and role/ownership review support it, propose a tightly scoped owner-run hosted change revoking function EXECUTE for PUBLIC, anon and authenticated while keeping ensure_rls intact. Before authorizing it, require an exact SQL/impact plan and a host-side preflight to detect drift. No broad schema changes, no SECURITY INVOKER conversion, no event-trigger deletion or automatic rollback, especially under NO_BACKUP_MVP. Post-change evidence needs its own authorization and validation.

**Option H6-S2 — explicit residual-risk acceptance (candidate):**
If independently justified, document precise exposure assumptions, the independent HTTP evidence, controls, decision owner, expiry/review trigger and conditions requiring revisiting. A false-positive characterization must not be asserted without parity evidence. Do not silently accept WARNs just because an isolated HTTP request fails.

**Current PM disposition:** neither option is ratified. Do not execute either, do not mark H6 security COMPLETE, do not provision rag_app and do not infer hosted permission from a PR merge.

## Next decision gate

Complete CI and adversarial independent review; reconcile findings; then request **one distinct human decision on H6-S1 or H6-S2**. A separate authorization is still needed for any hosted role, grant, migration, vector, DSN or E2 action.
