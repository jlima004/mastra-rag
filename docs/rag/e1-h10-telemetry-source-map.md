# E1 H10 — Supabase official telemetry source map (read-only preparation)

> **H10 CANCELLED (2026-11-18).** This source map is preserved as historical research only. Do not collect its metrics or make them an E2 gate for the Free-tier MVP. See [owner override](../decisions/RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md).

**Date:** 2026-11-18. **State:** SOURCES_IDENTIFIED / ORG_AND_PHYSICAL_VALUES_UNMEASURED / E2_ADMISSION_BLOCKED.

**Target:** Alquem.io Free organization bciquteonwtxyyerveik; mastra-rag project lmocjhpajhxegzobydau. As of the read-only project listing on 2026-11-18, 3 projects existed in the organization; 2 were INACTIVE. This inventory is **not** aggregate size evidence.

## Authoritative sources and distinctions

| Required value | Official source and procedure | Can we claim an observed value here? |
| --- | --- | --- |
| Organization Free database usage / quota by billing period | [Supabase organization Usage page](https://supabase.com/dashboard/org/_/usage), inspect the **Database size** tile and per-project/cycle breakdown; record period, timestamp, displayed units, average-vs-current semantics and the status of inactive projects | **NO**; no screenshot or numeric org meter provided |
| Inactive project contribution | [Supabase: Understanding Usage Summary](https://supabase.com/kb/troubleshooting/understanding-the-usage-summary-on-the-dashboard-D7Gnle): inactive projects active during the billing cycle can still affect average usage | **UNKNOWN**, do not restore inactive projects or assume zero |
| Current project database logical size | [Database report](https://supabase.com/docs/guides/platform/database-size) or read-only pg_database_size(current_database()) | **YES**, last project read returned 11,228,851 bytes, project-only |
| Physical disk used/total and WAL share | [Database Settings / Infrastructure](https://supabase.com/docs/guides/platform/database-size) show physical disk size, usage and distribution across Database/WAL/System; Free physical allocation fixed at 2 GB; 95% used triggers a best-effort read-only safeguard | **NO**, project DB bytes are NOT disk used or WAL |
| WAL time series and workload trends | [Supabase Metrics API](https://supabase.com/docs/guides/observability/metrics) and [Reports](https://supabase.com/docs/guides/observability/reports), available on Free, show PostgreSQL/WAL/IO health metrics | **NOT COLLECTED**; API is beta and its labels may change |
| E2 corpus and concurrent reservation | Representative official-source ingest/chunk/vector footprint + transactionally coordinated reservations; no generic provider dashboard can prove these | **NO** |

**Important billing distinction:** Supabase documents that its organization database-size Fair Use restriction is evaluated from the **average daily database size during the billing period**, whereas the live SQL project reading is an instantaneous snapshot. These are different measures and must not be substituted for each other.

## Secure evidence collection — future human-operated, no execution in this PR

- Organization: open the **existing** Supabase dashboard session for Alquem.io → Usage. Capture the quota/accounting period, project breakdown and values with units, without tokens/other sensitive data. Clarify whether inactive projects contribute at that period; if unclear, stop and seek an authoritative provider explanation.
- Project physical: use the existing project's Infrastructure and Database Settings dashboards (read-only) to record used/total disk and WAL distribution or verified provider time series. No SQL filesystem access, no administrative shell and **no project resume/restore**.
- Metrics API: official endpoint is privileged; authentication would require a **Secret API key**. **Not queried, not configured, and no key retrieved** in this PR; any automated collector would need a separate security/credentials approval.
- Enforce source and freshness evidence before E2; missing, stale or contradictory organization/physical metrics = **fail closed**. The current pure scripts/e1-capacity-policy.ts and scripts/e1-h6-h10-evidence-gate.ts do not collect metrics, enforce runtime admission, or reserve concurrent jobs.

## Ratified H10 capacity policy, unchanged

- Active vectors <= 2,000; at most one additional rebuild space.
- Private rag: warning at 80 MiB, stop at 100 MiB.
- Project database: warning at 250 MiB, stop at 300 MiB.
- Organization: warning at 350 **decimal** MB, stop at 400 **decimal** MB.
- Physical disk/WAL evidence mandatory. The pure local evaluator uses a conservative 95% disk check; this is not an independently ratified SLO and does not replace provider safeguards.

**NO_BACKUP_MVP** remains in force. No production backup, restore, PITR, real-db drill, new billable service or RPO/RTO is introduced. H7/H11/H12 and all E2/hosted write gates remain separate.
