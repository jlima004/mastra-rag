# RAG-E1 / H6-D2 — Security Adjudication (owner decision required)

**Prepared:** 2026-11-18. **Git baseline:** `master` `adf0cd8a1b360e240f5c20315aa687a73b2fa965` (PR #21 merged, exact-head CI SUCCESS, user-confirmed Railway health). **Status:** `H6_S1_RECOMMENDED / OWNER_RATIFICATION_PENDING / HOSTED_WRITES_BLOCKED`.

This document **reconciles** the evidence and presents an actionable choice. It does **not** ratify a human decision, grant permission for production SQL or claim that either Security Advisor warning is resolved. It implements the separately requested security adjudication *preparation*, not any hosted privilege modification.

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

## 5. Formal human adjudication

The owner must explicitly select exactly one:

- `RATIFY H6-S1` — ratify the *direction* of narrowly restricting `EXECUTE` after exact-target preflight. **This does not authorize running SQL.**
- `RATIFY H6-S2` — accept residual risk *only* with written justification, owner, review date and re-evaluation triggers.
- `H6-HOLD` — maintain existing state and all hosted-operation blocks.

Following **H6-S1** ratification, a *second, distinct* authorization is required for the precise hosted `REVOKE`, then independently verify postconditions. Until then `H6_SECURITY_DECISION_PENDING`; in particular, `rag_app`, catalog migrations, vector space, DSN, H7/H10/H11/H12 and E2 remain independently gated.

**No owner choice has yet been recorded in this document.**
