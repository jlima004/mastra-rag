# E1/H5 — Hosted catalog application receipt and independent postflight

> **2026-11-18 — E1_H5_HOSTED_CATALOG_MIGRATION = COMPLETE / VERIFIED.**
> This record supersedes pre-H5 catalog-pending statements in older preparation notes, without deleting historical audit evidence.

## 1. Authority, execution and exact baseline

- Owner explicitly authorized `E1_H5_HOSTED_CATALOG_MIGRATION` and operated the protected WSL command; the connected agent did **not** execute migration DDL.
- Target: `mastra-rag`, project `lmocjhpajhxegzobydau`, organization `Alquem.io` Free, `sa-east-1`, PostgreSQL 17.11.
- Source `master` at `e5101967370b159dd5bea8bfd67b042f44f0aca3` (PR #26 merged and deployed; H6-R2 credentials/independent authentication previously VERIFIED).
- Supabase CLI **3.1.0**, builtin `--profile supabase`, explicit target `--remote=lmocjhpajhxegzobydau`, exact repo `--workdir`, `--skip-vault` and a private interactive PostgreSQL administrator password. `--yes`, `--include-all`, `--include-roles` and `--include-seed` were not used.
- Local SQL: `supabase/migrations/20261117213614_rag_catalog.sql`, identical to `db/migrations/0001_rag_catalog.up.sql`, SHA-256 `19a6cc2b841e5670db4da7aad11f8c2fa8a886bd1f4dae5d65c72cc4dbe3d070` (operator's SHA-256 and file comparison). The existing foundation migration remained unchanged.
- Dry-run output identified exactly **one** pending catalog migration, target project `mastra-rag` production; no foundation replay. Then the owner's interactive `db push` prompt displayed **only** `20261117213614_rag_catalog.sql` for the correct target, the owner answered `Yes` and CLI reported `Applying migration...` then `Finished supabase db push.` The secret was removed from the shell environment afterward.
- This execution evidence is **redacted user-supplied terminal output**. No password, SCRAM verifier, token, DB URI with credentials, server-side logfile or text of the nine catalog tables is copied into this receipt.

## 2. Independent provider-scoped postflight (READ ONLY)

The connected Supabase project tool and independent metadata SELECTs were used **after** the owner's successful CLI exit. No DDL, replay, ledger edit, password rotation or production data writes were issued by the agent.

| Gate | Observed |
| --- | --- |
| Project state | `ACTIVE_HEALTHY` / PostgreSQL 17.11 |
| Remote ledger | Exactly `20261113233720` and `20261117213614` |
| Migration names | `enable_pgvector_create_private_rag_schema`, `rag_catalog` |
| Migration statement counts | Foundation 1; catalog 38, according to remote ledger |
| Foundation SQL SHA-256 | `9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13` |
| Catalog tables | **9/9**, precisely `embedding_space`, `source`, `document`, `document_version`, `chunk_set`, `chunk`, `index_build`, `document_publication`, `ingestion_job` |
| RLS | Enabled on all 9 tables |
| Policies | Exactly **9/9** (one per catalog table), scoped to `rag_app`, matching the reviewed migration |
| Ownership | All 9 tables and schema `rag` owned by `postgres`, not `rag_app` |
| `rag_app` role flags | LOGIN; NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; memberships = 0 |
| `rag_app` schema privileges | `rag` USAGE=true, CREATE=false; `extensions` USAGE=true, CREATE=false; `public` CREATE=false |
| `rag_app` table privileges | `embedding_space`: SELECT only; remaining 8: SELECT/INSERT/UPDATE/DELETE |
| `anon`, `authenticated`, `service_role` | No `rag` USAGE or table SELECT |
| Initial data rows | **0** in each of 9 catalog tables, including `embedding_space` |
| Vector space | No `chunks_*` public vector table and no PgVector space provisioning |
| H6-S1 | `anon`/`authenticated` EXECUTE on `public.rls_auto_enable()` remains revoked; `ensure_rls` event trigger enabled |
| Security Advisor | `lints=[]` (**zero security findings**) |

**Boundary of proof:** catalog SQL source hash is independently verified in the committed repository and owner's WSL. The hosted ledger contains the reviewed timestamp/name and actual catalog structures/grants/policies, but the remote SQL text was **not** claimed byte-identical to the local migration by comparing all ledger statements against the original file. The database operations performed for postflight were SELECT-only.

## 3. Non-blocking performance observations

Supabase Performance Advisor reported INFO-level findings **after** the new empty catalog appeared: **8 foreign-key constraints without a covering index** and **5 indexes with no recorded usage**. The latter is expected while the catalog holds zero rows and has no live workload. Do **not** drop unused indexes or add foreign-key indexes without an independently reviewed workload/DDL gate. The eight uncovered FKs should be evaluated before meaningful E2 data volume; they are not an H5 correctness or security failure.

- [Supabase Linter: unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Supabase Linter: unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

## 4. Decision and separation of authorities

**Operational decision: `E1_H5_HOSTED_CATALOG_MIGRATION = COMPLETE / VERIFIED`.** No repeat of `db push`, no repair of `supabase_migrations`, no destructive `down`, no follow-up DDL or credential change is required or authorized by this receipt.

This PR is **documentation only**. Its separate gates are exact-HEAD independent CI, Codex review, human merge and user-confirmed deploy. **H5 being operationally verified does not automatically authorize merging this receipt.**

**Separately blocked:** privileged PgVector flat-space creation/namespace grants and policies, runtime DSN/`disableInit` integration, H7/H11/H12 decisions and E2 ingestion/paid embeddings. **H10 remains canceled** for the Free MVP; `NO_BACKUP_MVP` is unchanged. No backup, restore or paid Supabase upgrade was performed.

**Current state:** `H5_HOSTED_CATALOG_COMPLETE_VERIFIED / SPACE_PENDING / DSN_PENDING / E2_BLOCKED`.
