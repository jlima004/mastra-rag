# RAG-E1 — Owner override: cancel H10 telemetry/capacity gate for Free-tier MVP

**Decision date:** 2026-11-18. **Authority:** owner request, *“Cancele H10, não quero medições organizacionais e físicas. Este projeto é um MVP ... tem que usar a conta free.”* **Precedence:** supersedes **H10-C1/C2** and all prior internal H10 organization/disk/WAL measurement, size-budget, capacity-admission and concurrency-enforcement requirements **as conditions for this MVP**. Historical decision documents are retained as evidence, **not active policy**.

## Ratified active MVP scope

- **H10 is canceled**, not pending. Do not request, schedule, measure or block work on organization-wide consumption, inactive-project contribution, physical disk use, WAL, physical capacity, quota forecasts, or representative corpus sizing for an H10 gate.
- **Supabase must remain on the Free plan**; confirmed using the official Supabase organization tool for **Alquem.io** on 2026-11-18: `plan=free`, `tier=tier_free`. Do **not** upgrade, add payment, restore inactive projects, purchase additional storage or create billable provider resources without a later explicit decision.
- Previous internally proposed H10 thresholds — 2,000 vectors, one extra space, `rag` 80/100 MiB, database 250/300 MiB, org 350/400 MB and physical 95% — are **retired as requirements for this MVP**. They remain historical fixtures/examples only. No current E2 gate may require `scripts/e1-capacity-policy.ts`, `scripts/e1-h6-h10-evidence-gate.ts`, or the original H10 metric fields as admission prerequisites. These pure helper modules have **not** been connected to runtime and are retained for history, not activated.
- Canceling project-created H10 gates **does not change Supabase-enforced Free limits** or guarantee uninterrupted availability, data durability, headroom, no suspension, or zero future cost. Honor provider errors and fail safely; do not automatically bypass hard provider limits.
- **NO_BACKUP_MVP remains a separate previously accepted decision**, unchanged. No hosted backups, external exports, restore exercises, upgrade, paid metrics, paid embeddings or other purchases are authorized by cancellation.
- **H5 migration ledger and H6 least-privilege decisions remain independent.** `rag_app`, catalog migrations, vector provisioning, runtime DSN, H7 access model, H11 embedding spend, H12 retention, and E2 ingestion still require their own authorizations. H10 metrics are **not** to be reintroduced indirectly through those gates without an explicit new owner decision.

## H6-S1 hosted execution record — same owner request

- **Authority:** owner explicitly requested: *“Execute E1_H6_S1_HOSTED_REVOKE e todo o necessário para essa execução.”* This authorizes exactly the previously ratified revocation on the targeted project `mastra-rag` (`lmocjhpajhxegzobydau`), not unrelated hosted DDL or application provisioning.
- **Preflight:** project identity `lmocjhpajhxegzobydau`, organization Free, PG 17; `public.rls_auto_enable()` owner `postgres`, `SECURITY DEFINER`, `RETURNS event_trigger`, `search_path=pg_catalog`, SHA-256 `b21d88816c445d14cef5032c3cd4abaebc1db2001fcb3435022ab6b496182ca4`, explicit EXECUTE grantees `PUBLIC,postgres,anon,authenticated,service_role`, active `ensure_rls`.
- **Action:** one transactional PostgreSQL `DO` block with exact preconditions and postconditions executed via project-targeted Supabase connector; its sole permission mutation was `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated`. No changes to function body, event trigger, or other grants. The database tool returned successfully without result rows.
- **Independent post-execution read:** exact same metadata query as `db/readonly/e1_h6_security_adjudication_preflight.sql` confirmed only `postgres` and `service_role` as remaining EXECUTE grantees; `anon=false`, `authenticated=false`, `service_role=true`; SHA-256 unchanged, `ensure_rls` enabled and tags unchanged. `rag_app` absent; no `rag` tables.
- **Official Supabase Security Advisor:** `get_advisors(type=security)` returned **zero findings** after the change. This is a point-in-time advisor result, not a complete independent proof that the production API has no other vulnerabilities.
- **Result:** `E1_H6_S1_HOSTED_REVOKE_VERIFIED`; do not repeat the revocation or broaden privileges. The next operator step, if any, must have a new explicit owner scope.

## Decision and evidence controls

**This document reports an already executed provider change.** It does not ask CI or GitHub to execute SQL. The publication PR may contain documentation and historical pure-helper annotations only, without migrations, secrets, production credentials, DSN changes or runtime modifications.

**Project status:** `H6_S1_HOSTED_REVOKE_VERIFIED / H10_CANCELLED_FOR_FREE_MVP / H5_H6_NEXT_OPERATIONS_SEPARATELY_GATED / NO_BACKUP_MVP`.
