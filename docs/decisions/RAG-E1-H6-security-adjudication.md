# RAG-E1 / H6-D2 — Security Adjudication (owner decision required)

> **EXECUTION UPDATE (2026-11-18):** The owner subsequently authorized and the assistant executed the targeted H6-S1 hosted `REVOKE` on `lmocjhpajhxegzobydau`. Independent catalog read confirmed `anon/authenticated` no `EXECUTE`, `postgres/service_role` retained, unchanged function hash and active `ensure_rls`. Supabase Security Advisor returned zero findings. The sections below retain the **pre-execution historical evidence** and must not be mistaken for the current state. See [execution and H10 cancellation](RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md).

**Prepared and owner-ratified:** 2026-11-18. **Git baseline:** `master` `adf0cd8a1b360e240f5c20315aa687a73b2fa965` (PR #21 merged, exact-head CI SUCCESS, user-confirmed Railway health). **Status:** `H6_S1_DIRECTION_RATIFIED / PR22_DOCUMENTARY_MERGE_AUTHORIZED / HOSTED_WRITES_BLOCKED`.

This document reconciles the evidence and records the owner's **H6-S1 directional ratification and approval of the documentary merge for PR #22**, expressed as **“Ratifico tudo.”** in direct response to the proposal to ratify H6-S1 **without authorizing execution on Supabase**. This is **not** authorization for production SQL and does not claim either Security Advisor WARN is resolved. No hosted privilege modification has been performed.

## 1. Authority and invariants

- [H6-D2 owner-ratified investigation](RAG-E1-H5-H6-H10-owner-ratification.md): isolated equivalent behavior and **distinct human decision** to restrict excess `EXECUTE` or document residual-risk acceptance; neither previously authorized.
- [PR #21 isolated PostgREST experiment](../rag/e1-h6-postgrest-isolated-assay.md): code-review reconciled, P2 thread resolved, merged as `adf0cd8a1b360e240f5c20315aa687a73b2fa965`. Three jobs passed on [CI #44346464821](https://github.com/jlima004/mastra-rag/actions/runs/44346464821); Node 153/153.
- [Earlier H6-S1/S2 unratified proposal](RAG-E1-H6-security-disposition-proposal.md) and [candidate operator procedure](../rag/e1-h6-security-operator-decision-package.md) remain supporting documents.
- `NO_BACKUP_MVP` stays in force. There is **no** authority to create/recover a hosted backup, modify the function body, switch it to SECURITY INVOKER, disable/drop the trigger, provision `rag_app`, apply catalog migrations, alter DSNs or start E2 ingestion.

## 2. Hosted evidence, read-only, reconfirmed 2026-11-18

Source: targeted Supabase project `lmocjhpajhxegzobydau`, PostgreSQL 17.11; **SELECT-only** system catalog and Supabase Security Advisor. No hosted RPC request, `REVOKE`, DDL, CLI login or secret handling was performed.

| Evidence | Observed result |
| --- | --- |
| Function | `public.rls_auto_enable()`, exactly one zero-argument function |
| Owner/security/return | `postgres`, `SECURITY DEFINER`, `RETURNS event_trigger` |
| Search path | `search_path=pg_catalog` |
| `pg_get_functiondef()` SHA-256 | `b21d88816c445d14cef5032c3cd4abaebc1db2001fcb3435022ab6b496182ca4` |
| Explicit `EXECUTE` grantees in `pg_proc.proacl` | `PUBLIC`, `postgres`, `anon`, `authenticated`, `service_role` |
| Effective `EXECUTE` | `anon=true`, `authenticated=true` |
| Event trigger | `ensure_rls`, `ddl_command_end`, enabled `O`; tags `CREATE TABLE`, `CREATE TABLE AS`, `SELECT INTO` |
| Other E1 state | `rag_app` absent; `rag` contains zero application tables |
| Advisor | **2 existing WARNs**: `anon_security_definer_function_executable` and `authenticated_security_definer_function_executable`; observed at 2026-11-18T16:27:39Z |

The `PUBLIC` grant matters: revoking only named `anon` and `authenticated` grants could still leave **effective `EXECUTE` through `PUBLIC`**. Conversely, the existing `postgres` and `service_role` grants are separate and intentionally **outside** the proposed narrow remediation. No evidence here proves that either grantee calls the function at runtime.

Advisors: [anon WARN](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0028_anon_security_definer_function_executable) and [authenticated WARN](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable). Supabase [API security](https://supabase.com/docs/guides/api/securing-your-api) explains role grants and RPC reachability; the [event-trigger guide](https://supabase.com/docs/guides/database/postgres/event-triggers) describes the DDL mechanism.

## 3. Isolated experiment, reconciled — not hosted proof

- Disposable PostgreSQL **17.12** + independently containerized PostgREST **v16.6**, digest `sha256:5ce030c153500fe90ba157da4da8ba99ab51d3bc7b95e071bd0b544b67a632f7`; synthetic JWT and credentials.
- Before local-only `REVOKE`, HTTP POST RPC returned **400 / SQLSTATE 0A000** for both synthetic `anon` and `authenticated`.
- After local-only `REVOKE` for `PUBLIC`, `anon`, `authenticated`: **anon 401 / 42501**, **authenticated 403 / 42501**. Independent `current_user` control RPC verified both roles. The event trigger remained enabled and RLS was still automatically applied to a newly created **disposable** table.
- The first CI failed because its negative-response matcher accepted an overly broad set of errors; the resulting Codex P2 was fixed with phase- and role-specific exact HTTP/SQLSTATE matching. Final exact-head CI and Codex review passed, and the P2 thread was resolved.
- **Hosted parity boundary:** the Supabase PostgreSQL minor version is 17.11, versus 17.12 in CI; hosted PostgREST binary/version, request gateway, JWT settings and exposed API schema configuration were **not verified**. There was no production RPC probe. This prevents asserting that a hosted call will produce the same HTTP status or that the WARNs have been proven false positives. The general least-privilege decision remains relevant despite this gap.

## 4. Decision matrix

| Option | Operational result | Residual uncertainty | PM position |
| --- | --- | --- | --- |
| **H6-S1 — restrict excess EXECUTE** | Remove function `EXECUTE` from `PUBLIC`, `anon` and `authenticated` only; preserve function definition, event trigger, `postgres`, `service_role` and all other grants. Requires a separate explicitly authorized hosted transaction and post-checks. | Local PG17/PostgREST result is supporting evidence, not a production rehearsal; unexpected hosted dependencies may exist. | **RECOMMENDED** — smaller externally callable privilege surface, consistent with documented advisor remediation. |
| **H6-S2 — accept residual risk** | Leave current grants/trigger unchanged; record owner rationale, accountable approver, effective duration/review date and re-evaluation triggers. WARNs remain intentional. | Retains unnecessary caller privileges unless a documented concrete need is established; isolated HTTP failure cannot establish universal inaccessibility. | **NOT RECOMMENDED** without independently verified necessity and compensating controls. |
| **H6-HOLD** | Preserve unchanged state and stop H6 execution. | Decision and warnings remain open. | Default until explicit human ratification. |

**PM recommendation:** **H6-S1**, with **no automatic production execution**. The recommended scope is the three named grantees only; removing `service_role` requires a separate assessment and is not bundled here.

## 5. Formal human adjudication — decision recorded

**Owner decision, 2026-11-18:** **H6-S1 RATIFIED (direction only)** and **PR #22 documentary merge AUTHORIZED**. The owner replied **“Ratifico tudo.”** to a prompt explicitly limiting approval to H6-S1 and documentary merge, **without authorizing execution in Supabase**. The literal reply does not authorize the distinct SQL execution gate.

- **Selected:** `RATIFY H6-S1` — restrict function `EXECUTE` from `PUBLIC`, `anon` and `authenticated` while preserving the function definition, `ensure_rls`, `postgres` and `service_role` grants, conditional on separate preflight and operator review.
- **Not selected:** `RATIFY H6-S2` — no residual-risk acceptance; both advisor WARNs remain unresolved until independently validated after a later authorized action.
- **Not selected:** `H6-HOLD` as the architectural direction, but **all hosted writes remain blocked**.
- **Merge approval:** PR #22 only, after exact-final-HEAD CI and review reconciliation. It does not approve any other PR, runtime change or deployment of privileged SQL.
- **Next independent approval:** explicit authorization for the exact hosted `REVOKE`; in its absence, no user or agent may run it.

The **H6-S1 directional decision is closed**. A *second, distinct* authorization is still required for the precise hosted `REVOKE`, followed by independently verified postconditions; until then `H6_HOSTED_EXECUTION_NOT_AUTHORIZED`. In particular, `rag_app`, catalog migrations, vector space, DSN, H7/H10/H11/H12 and E2 remain independently gated.

**No hosted privilege revocation, migration or production verification is claimed by this document.**
