# RAG — H10 decision: no backups in the MVP

| Field | Value |
| --- | --- |
| Owner decision | **"H10 Não haverá backup no MVP."** |
| Decision date | 2026-11-17 |
| Scope | **MVP only**, Supabase Free `mastra-rag`, private RAG catalogue and projections |
| Status | **OWNER_DECIDED_NO_BACKUP_MVP / CAPACITY_GATE_PENDING / HOSTED_OPERATIONS_NOT_AUTHORIZED** |
| Supersedes | The **backup and recovery prerequisites** from [E1 owner ratification](RAG-E1-owner-ratification.md), [H5/H6/H10 readiness proposal](RAG-E1-H5-H6-H10-operational-readiness.md), and relevant SPEC/ADR/plan sections |
| Does not supersede | H5 migration-history and remote-applier rules, H6 least-privilege security, H7/H11/H12, storage capacity/limits, independent review, human authorization for hosted actions |

## Decision and boundary

For the MVP **do not implement or require database backups**, either hosted backup/PITR, off-site encrypted logical dump, pre-migration backup, scheduled snapshot, or restore of a real hosted database. No paid backup plan, off-site backup destination, storage credentials, backup monitoring, RPO/RTO SLO, or real-restore drill is part of MVP acceptance.

This specifically **removes backup generation and proven real-hosted-data restoration as prerequisites** for later, separately authorized persistent ingestion. The owner did **not** authorize ingestion or remote migrations through this statement; those gates remain independent. Do not rewrite the older owner-ratification document's historic content: this dated decision **supersedes it on H10 backup policy only**.

The CI synthetic `pg_dump` → `pg_restore` drill remains a useful **disposable test of schema, constraints and role correctness**. It contains synthetic fixtures only, is deleted after CI, and is **not** an MVP backup or recovery requirement.

## Risk consequences (disclosed; no recovery guarantee)

- Deletion, corruption, damaging migrations, hosted project loss and operator error may cause **permanent loss** of catalog records, publication pointers, ingestion history and vectors. Neither point-in-time recovery nor restore-to-last-backup is available from a project-managed MVP backup.
- **RPO/RTO are undefined and uncommitted**: there is no guaranteed recoverable point or restoration duration. Do not publish a `24h` RPO or `4h` RTO.
- The initial corpus is intended to use public official LGPD/ANPD source documents. Re-fetching, re-rendering and re-embedding these documents **may** recreate derived search data, but this is a **possible future rebuild strategy, not a tested or guaranteed recovery plan**. Sources can disappear/change; historical versions, state and paid embedding expenditure might not be recoverable. E2 reconstruction tooling is not yet implemented.
- Do not silently expand MVP storage to user submissions, private personal information, payments, audit-only records, or any uniquely authored data that cannot be regenerated; such a scope change requires a fresh data-durability and risk decision.

The owner's no-backup scope decision is explicit. The above are documented consequences, **not evidence that data durability has been demonstrated**.

## Controls that remain mandatory before hosted persistence

1. **H5**: preserve Supabase migration history; select and freeze one applier/ledger; verify exact reviewed SQL and target; run in an isolated fixture first, and obtain separate explicit human authorization for remote DDL. Without backups, **do not auto-run destructive down, DROP, TRUNCATE, or irreversible data migrations**. Changes touching nonempty/nonreconstructible data need independent impact adjudication. There is no promise of rollback from dump.
2. **H6**: review least-privilege `rag_app` operator setup and RLS, project security advisors, credentials and DSN. Remote role/grants/provisioning remain unauthorized pending distinct approval.
3. **H10 capacity**: size the actual corpus and enforce an owner-approved storage limit / admission stop on the Supabase Free project, including catalog, vectors, old spaces, indexes and headroom. Earlier **2,000 vectors, 100 MiB rag, 250 MiB warning, 300 MiB database stop** were *proposed*, not automatically ratified by the no-backup decision.
4. **H7/H11/H12 and E2**: access model, embedding spend/real calls, data retention/GC, durable jobs, publication/locking and live ingestion remain subject to their separate gates.
5. Verify post-change database state, RLS, schema and health at every approved step; record the observed results without storing secrets or sensitive source/query text.

## Later reassessment

Reconsider backup/recovery **after the MVP** or before adding nonreconstructible or sensitive data. That is a future decision, not an automatic obligation or current work item.

**Current decision state:** `H10_NO_BACKUP_MVP_DECIDED / H10_CAPACITY_UNAPPROVED / H5_H6_REMOTE_GATES_OPEN / NO_HOSTED_WRITES`.
