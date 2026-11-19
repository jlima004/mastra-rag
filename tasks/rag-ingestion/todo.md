## H7 — Operational Access (operator-only MVP; 2026-11-19)

Owner requested execution of `H7 — Operational Access` after E1 hosted `rag_app` readiness returned HTTP 200 / `{"status":"ok"}`. This authorizes H7 preparation and operator-only hardening, **not automatic removal/rotation of secrets, new production endpoints, H11 spending or E2 ingestion**.

- [x] H7 policy proposed for MVP: **single operator-only principal**, default-deny ingestion/retrieval, no reader/demo/public token, no unauthenticated vector/API routes.
- [x] Existing `RAG_SERVER_API_TOKEN` production presence (value masked), `SimpleAuth` and protected readiness route confirmed; exact source audit finds no `SUPABASE_DB_PASSWORD` reference in `src/`.
- [x] Production secret **name-only** inventory identifies `SUPABASE_DB_PASSWORD` (operator/admin secret, not runtime) and `OPENAI_API_KEY` (H11 not ratified) as candidates for owner-controlled runtime removal.
- [x] H7 code hardening: `SimpleAuth` tokens use a null-prototype lookup map; unit and production-bundle negative tests for prototype-key/invalid tokens.
- [ ] H7 Draft PR exact-HEAD CI, independent Codex/security-focused review, human merge/deploy authorization.
- [ ] Owner-only audit of Mastra Platform organization members and access tokens, least-privileged roles, MFA/SSO policies where offered; secret ownership recorded outside Git.
- [ ] Owner-only removal of unused administrative `SUPABASE_DB_PASSWORD` and unused `OPENAI_API_KEY` from **production runtime** after confirming no operational consumers depend on them; recheck readiness with operator token. **Do not expose actual values.**
- [ ] Explicit human assessment of the residual production use of `SimpleAuth` (documented for development/testing) and operator token rotation/incident handling before marking H7 COMPLETE.
- [ ] After release, actual production negative-access smoke (anonymous/invalid/special-key bearer and alternate header) plus positive authorized readiness `200 {"status":"ok"}`, all without publicizing tokens.
- [ ] H11 provider budget, H12 GC/retention and E2 mutations remain separately blocked. H10 Free MVP cancellation and `NO_BACKUP_MVP` unchanged.

Evidence: [H7 operator-only access decision and runbook](../../docs/decisions/RAG-H7-operator-only-access.md).

---

# RAG ingestion — tracking checklist

**Latest decisions (2026-11-17):** [H5/H6/H10 owner ratification](../../docs/decisions/RAG-E1-H5-H6-H10-owner-ratification.md) approved the operator design and storage **numerical policy**; capacity measurement/enforcement and all hosted permissions remain pending. [NO_BACKUP_MVP](../../docs/decisions/RAG-H10-mvp-no-backup.md) remains in force; older backup/restore/RPO/RTO requirements are superseded.

Status legend: `[ ]` not done · `[x]` done. Stage A ratified partially on 2026-11-16; Steps B–D offline merged; E1 H4/H5/H6 directions and conditional H10 policy ratified 2026-11-17 for **local implementation only**. PR numbers after #7 are provisional (see [`plan.md`](plan.md)).

## Step A — Specification (PR #7)

- [x] SPEC drafted: `docs/specs/SPEC-rag-ingestion.md`
- [x] ADR drafted with D1–D6 as `PROPOSED`: `docs/architecture/ADR-rag-ingestion.md`
- [x] Plan and checklist drafted
- [x] README roadmap section updated
- [x] CI green on the PR head (`638d206`)
- [x] Independent adversarial review findings resolved (namespace, GC, sync execution, deletion, model switch, evidence table)
- [x] Codex review on `40bc6c2` (3× P2) addressed in R2; re-review on `638d206` reported no major issues

## Human decision gates

- [x] D4–D6 architectural **principles** accepted (not their physical schema, SQL, live APIs, retention or operational grants)
- [x] [Stage A partial decision](../../docs/decisions/RAG07-stage-a-ratification.md) recorded; H4–H8 and H10–H12 remain pending
- [x] PR #7 amended HEAD re-reviewed (CI + independent Codex) and merged by owner


- [x] H1 Corpus / use case accepted for MVP: LGPD + selected CD/ANPD resolutions (exact official sources pending Step B)
- [x] H2 Initial formats accepted: HTML + Markdown/TXT; PDF phase 2; no OCR
- [x] H3 Model baseline accepted: `openai/text-embedding-3-small` @1536; **account/billing and paid use remain pending H11**
- [x] H4 direction ratified for **local E1** (PgVector + catalog, exact search first); physical SQL and E1-P2 reconciliation remain pending
- [x] H5 direction ratified for **local E1** (versioned `db/migrations/`, owner-only remote applier); migration history and SQL approval pending
- [x] H6 least-privilege **design direction** ratified for local tests; hosted role creation and DSN rotation **not approved**
- [ ] H7 MVP access model ratified (proposed: operator-only)
- [ ] H8 Mastra environment and Turso regions verified; latency accepted or region plan decided
- [x] H9 Dependency *evaluation* conditionally accepted; actual parser/tokenizer/`zod` package installations require separate version/security review and owner approval
- [x] H10 **NO_BACKUP_MVP** decided 2026-11-17 ([owner decision](../../docs/decisions/RAG-H10-mvp-no-backup.md)); [ ] actual corpus and storage-limit enforcement pending
- [ ] H11 Embedding spend cap and evaluation budget set
- [ ] H12 Retention and GC windows ratified (proposed: 7-day grace; immediate purge on erasure)

## Step B — Contracts and validation (expected #8)

- [x] Manifest entry for LGPD with official canonical reference and copyright note; live availability pending Step C
- [x] CD/ANPD candidates checked against ANPD's official regulation index: #15/#18 in manifest; amended #2 and corrected #19 documented as deferred; live DOU fetch pending Step C
- [x] Deterministic IDs + strict canonical JSON implemented; SPEC §6.4 golden regression assertions added (CI pending)
- [x] Manifest/URL/allowlist validation, unknown-ID and private-host syntax rejection tests added; DNS pinning deferred to Step C
- [x] Offline magic-byte, UTF-8 text, legacy-HTML sniffing and size-limit tests added; full charset detection deferred to Step C
- [x] Sanitized fixed error-code catalogue added
- [x] PR #8 CI green (60/60), final Codex review no findings, human merge + deploy confirmed

## Step C — Fetch, extraction, normalization, chunking (expected #9)

- [x] Inert native HTTPS fetcher implemented with reviewed manifest allowlist, manual redirects ≤ 3, DNS IPv4 pinning/public-only filtering, timeouts and 5 MiB streaming cap; **only mocked transport executed in tests**
- [x] Experimental restricted-HTML fixture extractor with UTF-8/Windows-1252 charset, revoked markup removal, amendment annotations and legal hierarchy; **official Planalto/DOU HTML parser validation still pending H9**
- [x] Legal locators (`lgpd:art5:inc2`, `lgpd:art55-j`, `parunico`) have synthetic regression tests
- [x] NFC normalizer + exact UTF-16 offsets reproduce all emitted body substrings in synthetic tests
- [x] Structural + recursive byte-budget-proxy baseline implemented and tested for deterministic chunk IDs and overlap; **actual token-count calibration pending H9**
- [ ] Official LGPD source snapshot, current text review, provenance and measured `cl100k_base` token statistics (blocked: verified source access and H9 tokenizer). Synthetic fixture committed; byte-proxy stats are not model token statistics.
- [x] RAG09 R1–R3 remediations reviewed by Codex with no final findings; PR #9 merged into master and deploy confirmed
- [x] RAG09 CI post-merge 85/85 tests; Codex final review without findings; human merge and deploy complete

## Step D — Embeddings (PR #10 merged; offline-only)

- [x] `EmbeddingProvider` interface and immutable MVP space registry type
- [x] Lazy `ModelRouterEmbeddingModel` adapter for `openai/text-embedding-3-small`; explicit paid-call gate, injection-only tests
- [x] Batching ≤128, **global** job retries (≤4 attempts; at most 3 retries), backoff + jitter, `Retry-After`, signal abortion
- [x] Per-job + supplied daily token budget, worst-case call/reservation bound; conservative **UTF-8 byte-plus-eight proxy**, not calibrated model-token counts
- [x] Exact dimensions, finite values, reported usage and vector-count validation **before any future upsert**
- [x] No OpenAI key at import, no server registration; missing-key startup requires CI smoke
- [ ] H11: owner-ratified account, provider-side hard spend cap, daily/token budgets, paid authorization
- [ ] H9: approved tokenizer for validated preflight accounting; no package installed in this PR
- [x] PR #10 exact-head CI full PASS (105/105), independent Codex re-review no material findings, human merge @ `0075155`. **No live embedding, DDL or production ingestion authorized**.

## RAG-E1 — Owner direction ratification and implementation kickoff (2026-11-17)

Authority: [RAG-E1 owner ratification](../../docs/decisions/RAG-E1-owner-ratification.md). Work order: [Step E1 local implementation](step-e1-local-work-order.md). This updates **direction status only**, not hosted-operations approval.

- [x] H4 direction ratified for local E1: catalog + PgVector, flat-first; E1-P2-01/02/03 physical reconciliation required
- [x] H5 direction ratified for local E1: versioned SQL, test up/down/up locally, owner-only remote application
- [x] H6 direction ratified for local E1: least-privilege `rag_app`, RLS, namespace; local proofs required
- [x] H10 historical Free-with-backup policy superseded by **no backups in the MVP** (see [later decision](../../docs/decisions/RAG-H10-mvp-no-backup.md))
- [ ] H4 exact DDL and persistent IDs independently reviewed and tested locally
- [ ] H5 migration history reconciled with preexisting Supabase migration `20261113233720`
- [ ] H6 least-privilege and PgVector upsert proven under local PostgreSQL RLS; `rls_auto_enable` advisory reviewed separately
- [ ] H10 capacity estimate, project-size ceiling and admission checks approved before persistent ingestion; **no real backup/restore or RPO/RTO gate for MVP**
- [ ] E1 separate implementation Draft has code/SQL, local CI, exact-HEAD independent review, human merge authorization
- [ ] E1 hosted migrations, role/DSN rotation and provisioning separately authorized; do not infer from ratification

## RAG-E1 — Documentation-only adjudication checkpoint (2026-11-17)

Reference: [E1 decision proposal](../../docs/decisions/RAG-E1-adjudication-proposal.md). Authorized: record/review decisions only; H4/H5/H6/H10 remain PENDING.

- [x] GitHub baseline verified: Step D PR #10 merged as `0075155`; CI SUCCESS 105/105
- [x] Supabase read-only evidence obtained: Free, São Paulo, PostgreSQL 17, `rag` schema with no tables, pgvector installed, migration baseline `20261113233720`, no `rag_app`
- [x] Existing `public.rls_auto_enable()` security-advisor warnings recorded for separate authorized investigation; no grants changed
- [x] Proposals E1-P2-01/02/03 documented (rendered identity, v2 ingestion idempotency, no-op semantics)
- [x] PR #11 exact-head CI PASS and Codex review with no material findings; documentation PR merged
- [ ] Owner H4 decision: physical identity uniqueness, RLS, indexes/constraints and effective v2 provenance
- [ ] Owner H5 decision: migration paths/history, owner applier, backups and rollback
- [ ] Owner H6 decision: `rag_app` privilege/role policy, safe treatment of security advisory
- [x] Owner H10 backup policy superseded: **no backups in MVP**; [ ] storage-capacity budget remains undecided
- [x] Owner explicitly authorized a separate **local-only E1 Draft PR**; remote DDL/upsert/secret changes remain withheld

## Step E1 — Local-only implementation (PR #12 MERGED; hosted execution still blocked)

Evidence and boundaries: [Step E1 local note](../../docs/rag/step-e1-local.md). No hosted SQL, billing, deployment or credentials changed.

- [x] E1-P2-01: rendered identity provenance exposed (base/rendered ID, effective charset, normalized SHA, canonical header metadata)
- [x] E1-P2-02: `rag:job:v2` pure key and independent frozen SHA-256 goldens; historical `rag:job:v1` preserved
- [x] E1-P2-03: pure `no_op`/freshness/reversion assessment; E2 DB-locked publication remains unimplemented
- [x] Catalog up/down SQL candidate created with rendered identity, nullable measured tokens and guarded RLS
- [x] Local-only `flat` PgVector operator script and disposable PostgreSQL 17 SQL fixtures authored
- [x] Runtime vector-store factory configured with `disableInit: true`
- [x] Exact-head PostgreSQL 17 + pgvector up/down/up, role/RLS/upsert and negative tests PASS (PR #12)
- [x] Full exact-head baseline CI/tests/typecheck/build/auth smokes PASS (117/117, run #44130166543)
- [x] Independent Codex review of final HEAD; P1 DSN-remediation accepted, no material findings at `2f73b800`
- [ ] H5 remote migration-history/owner-applier mapping independently approved
- [ ] H6 existing security advisor finding resolved/accepted separately before hosted changes
- [ ] H10 actual corpus sizing, storage ceiling and operator enforcement; no backups or RPO/RTO in MVP
- [x] Owner merged PR #12 @ `4547f6abe15a414b65a09d710888d8bbaa2f86a6`, post-merge CI #44136691725 SUCCESS
- [ ] Owner separately authorizes any hosted catalog migration, role/DSN rotation, and space provisioning



- [ ] Migration up/down SQL reviewed (catalog, indexes, RLS including space-table UPDATE, grants)
- [ ] Provisioning script with `indexConfig: { type: 'flat' }`
- [ ] Non-transactional migration class noted for future HNSW
- [ ] CI green, review, human merge
- [x] Owner decided **no logical dump of `rag` in MVP**; excluded from MVP acceptance
- [ ] Owner: migration applied
- [ ] Owner: `rag_app` created, runtime DSN rotated, readiness probe green (`NOT rolsuper`)
- [ ] Owner: space `chunks_te3s_1536_v1` provisioned

## RAG-E1 — H5/H6/H10 operational readiness checkpoint (new Draft)

Reference: [readiness proposal and read-only evidence](../../docs/decisions/RAG-E1-H5-H6-H10-operational-readiness.md).
Scope is preparation and **synthetic local restore testing only**; no hosted SQL, backup export, secrets or provisioning has been authorized.

- [x] Verified remote Supabase migration history: only foundation `20261113233720` present; `rag` empty, no `rag_app`
- [x] Verified Free backup limitations, vector extension and current size via read-only project checks
- [x] H5 single-ledger / owner-applier migration contract **proposed**, not yet operator-ratified
- [x] H6 hosted role setup and password/DSN boundary **documented**, not executed
- [x] H10 capacity ceilings proposed but not ratified; **backup and RPO/RTO proposals withdrawn for MVP**
- [x] Synthetic disposable `pg_dump` → separate PostgreSQL 17 database `pg_restore` CI proof PASS (PR #13); **not a production backup**
- [x] PR #13 CI PASS on exact HEAD `a5a85ab`: 117/117 tests, build/auth smokes, synthetic restore and role upsert
- [x] PR #13 Codex re-review on final HEAD: P2 extension usage corrected, no new material findings
- [x] PR #13 merged into `master` @ `248c0ba096c55e8e432ab0bfbfb3a49e2c2a8f28`; post-merge CI SUCCESS
- [ ] Formal owner approval of **single** migration applier, CLI version/history contract
- [ ] Separate owner approval of H6 role privileges and review of `rls_auto_enable()` advisor findings
- [ ] Owner approval of actual corpus storage budget; **no RPO/RTO objective for MVP**
- [x] Off-site backup destination/key/retention excluded from MVP by H10 decision
- [x] Real hosted backup and restore drill excluded from MVP by H10 decision
- [ ] Hosted E1 DDL/role/DSN/space provisioning separately authorized and verified

## H10 MVP no-backup decision — latest owner override (2026-11-17)

- [x] Owner explicitly chose **no backups for MVP**: no hosted PITR, external dump, pre-migration backup, automatic export or real-database restore drill
- [x] RPO/RTO objectives withdrawn for MVP; risk of permanent database loss and unrecoverable history explicitly documented (no operational recovery guarantee)
- [x] Keep the PR #13 synthetic restoration as local **CI correctness evidence only**, not as a condition for hosting MVP data
- [ ] Size the verified official corpus and choose an owner-approved Free-plan storage cap/monitoring/admission stop; example thresholds from earlier readiness are not automatically approved
- [ ] H5 migration ledger and non-destructive SQL plan independently ratified and remotely authorized
- [ ] H6 least-privilege hosted role and remaining `public.rls_auto_enable()` advisor separately adjudicated and authorized
- [ ] H7, H11, H12 and any E2 remote operation separately approved; **H10 no-backup does not imply permission to ingest**

## H5/H6/H10 capacity — hosted operational adjudication proposal (2026-11-17)

Reference: [hosted adjudication matrix](../../docs/decisions/RAG-E1-H5-H6-H10-hosted-adjudication.md). **This is a proposal, not hosted execution authority.** Supabase read-only checks only; PR #14 merged and H10 no-backup policy preserved.

- [x] Read-only recheck: project `mastra-rag` PostgreSQL 17.11, vector 0.8.2, private `rag` empty, `rag_app` absent, one foundation migration
- [x] Read-only role/function review: two `public.rls_auto_enable()` SECURITY DEFINER advisor WARNs confirmed; no remote security changes
- [x] Free organization has other inactive projects; org-wide database size contribution **unmeasured**, so project-only size is insufficient to approve an ingest cap
- [x] H5 single hosted ledger and owner-only applier proposed; foundation history remapping and exact CLI pin remain to be validated
- [x] H6 role/extension USAGE, catalog and PgVector operator sequence proposed; no privileged remote action authorized
- [x] H10 capacity proposal documented: 2k active vectors; 1 rebuild; 100 MiB rag; 250/300 MiB project; 350/400 MB organization; values **unratified**
- [x] H10 `NO_BACKUP_MVP` decision preserved; no real backup/restore/RPO/RTO preconditions
- [ ] Exact-HEAD CI and independent Codex review of this documentation-only proposal
- [ ] Separate human merge approval for adjudication document PR
- [ ] **Human ratification** of H5-D1/D2, H6-D1/D2 and H10-C1/C2, including actual numeric limits and risk handling
- [ ] Confirm organization-wide quota headroom, including any contribution from inactive projects; physical disk/WAL monitoring before E2
- [ ] Separate human approval of role and security operator package, catalog migration, vector space provisioning, runtime DSN, and E2 ingest
- [ ] H7 operator access model, H11 paid provider budget and H12 retention/GC separately closed

## H5/H6/H10 owner ratification — latest authority (2026-11-17)

Authority: [explicit H5-D1/D2, H6-D1/D2, H10-C1/C2 owner ratification](../../docs/decisions/RAG-E1-H5-H6-H10-owner-ratification.md). Historic unchecked proposal checkboxes above reflect the PR #15 drafting time; **these choices are now ratified**, while their remote implementation is not.

- [x] PR #15 merged to `master` at `d7f745e73acd0601ad7067e6905a46f807ae20ef`, post-merge CI #44177541850 **SUCCESS**, Mastra Cloud build and health **PASS**, owner confirms deploy
- [x] H5-D1: one hosted `supabase_migrations.schema_migrations` ledger; owner-only human-controlled applier; foundation migration `20261113233720` preserved
- [x] H5-D2: Supabase CLI v3 direction, **exact CLI version not yet pinned** and historical foundation mapping not yet verified
- [x] H6-D1: `rag_app` least-privilege server-only contract, `rag` + `extensions` USAGE, RLS, `public` namespace; role/catalog/space operations independently gated
- [x] H6-D2: separately investigate both `public.rls_auto_enable()` WARNs; **no risk acceptance or remote revocation yet**
- [x] H10-C1: **2,000** active vectors; maximum one additional rebuild space; **80/100 MiB rag** warning/stop; **250/300 MiB project** warning/stop; **350/400 MB organization** warning/stop
- [x] H10-C2: require organization-wide Free headroom and independent physical disk/WAL metrics; fail closed for new ingestion/reindex on missing or exceeded metrics
- [x] H10 backup: **NO_BACKUP_MVP** unaffected; no external/real backup, PITR, RPO/RTO or real restore drill
- [ ] Pinned specific v3 CLI, current `--help` proof, local/remote history mapping and generated timestamp migration matched to canonical reviewed SQL
- [ ] Isolated review of `rls_auto_enable()` WARNs and **separate** remediation or explicit risk-acceptance owner decision
- [ ] Measure/verify aggregate org Free quota usage (two other inactive projects), disk/WAL, representative corpus footprint; implement tested capacity admission before E2
- [ ] Operator role/SQL/space/DSN package reviewed under exact-HEAD CI and independent Codex review
- [ ] **Distinct explicit owner authorizations** before any hosted role/grant/DDL, PgVector space creation, DSN rotation, paid embedding or real ingestion
- [ ] H7 operator access, H11 spend cap and H12 retention/GC ratified before live E2

## E1 — Pacote operacional LOCAL (PR #17 Draft, 2026-11-17)

[Execution plan and evidence](../../docs/rag/e1-operator-package.md), base `master` `01536e23491eada66667acbc1189289628792cf9`. H5/H6/H10 policy ratified; **no Supabase hosted writes approved**.

- [x] H5 mirrored exact existing hosted foundation statements at `supabase/migrations/20261113233720_enable_pgvector_create_private_rag_schema.sql` (read-only; never reapply)
- [x] H5 pinned CLI `3.1.0` via `supabase/setup-cli@v3` and ran isolated `migration new rag_catalog`; recorded CLI-generated filename from CI #44181461137
- [x] H5 staged `supabase/migrations/20261117213614_rag_catalog.sql` as exact reviewed `db/migrations/0001_rag_catalog.up.sql` copy, plus CI bytewise identity guard; **not pushed to hosted**
- [x] H6 added disposable `rag_app` role/RLS/grants assertions and isolated event-trigger `EXECUTE` revocation regression; no hosted role/privilege changes
- [x] H10 pure capacity admission candidate with tests for limits, unknown org/disk/WAL, invalid inputs and overflow; **not wired to E2 runtime**
- [x] Read-only project-level SQL meter for DB/`rag` size exercised in disposable PG17; **org aggregate and disk/WAL still require separate evidence**
- [ ] Exact-HEAD PR #17 CI (117+ Node tests, build/auth, PG17 RLS/security, local CLI) PASS with artifacts reviewed
- [ ] Independent Codex adversarial review of exact HEAD (P0/P1/P2 reconciled)
- [ ] Separate owner authorization to merge/deploy PR #17
- [ ] Future read-only hosted ledger check under pinned CLI, confirmed `rag_app` secret procedure and security advisor disposition
- [ ] Real organization quota/disk/WAL measurements and robust concurrent capacity reservations before E2
- [ ] Separate human authorization for hosted role/grants, catalog migration, flat vector space, secrets and E2 live ingestion; H7/H11/H12 still open

## E1 — Hosted execution readiness (read-only checkpoint, 2026-11-17)

Evidence: [hosted readiness runbook](../../docs/rag/e1-hosted-execution-readiness.md). Scope: **read-only Supabase assay + local/CI evidence validation; NO hosted writes.** PR #17 merged to `master` at `737b13d9a0de0ff0c27d93a7422f9ed03291a931` with post-merge CI and Mastra Cloud deployment PASS.

- [x] H5 hosted migration ledger re-read through connected Supabase metadata: exactly `20261113233720`, SHA-256 of foundation `9c36f409c82917f523f6c034ab576409a0e3ee6711901c4b09bcc04e3b2e4e13`; catalog version `20261117213614` not present
- [x] Hosted read-only SQL confirms PostgreSQL 17.11, `rag` empty, `rag_app` absent, pgvector 0.8.2 in `extensions`, private schema and 11,228,851 DB bytes
- [x] H6 security advisor re-read: two unresolved `public.rls_auto_enable()` WARNs, no production REVOKE or risk acceptance
- [x] H10 three-project Free organization confirmed (two INACTIVE); **org-wide size and physical disk/WAL unknown**; no paused-project restore/provisioning
- [x] Dedicated read-only hosted baseline SQL and fail-closed pure validator with CI tests; validator **cannot authorize any write**
- [ ] Current PR exact-head CI and independent Codex review; separate human document-only merge approval
- [ ] Human-only Supabase CLI v3.1.0 **remote** migration-list reconciliation/dry-run with explicit read-only target approval and no repair; prior connected metadata check does not count as a CLI proof
- [ ] H6 PostgREST-equivalent independent security analysis and owner decision for REVOKE or residual-risk acceptance
- [ ] Organization quota metering and disk/WAL provider telemetry, verified fresh; enforce transactional H10 admission later
- [ ] Independent human approvals for remote role/secret, catalog SQL, vector space, DSN; H7/H11/H12 and E2 ingestion remain blocked
- [x] H10 `NO_BACKUP_MVP` remains in force

## E1 — H5 authenticated CLI historian gate (read-only authorization, 2026-11-17)

[Read-only CLI gate and operator script](../../docs/rag/e1-h5-remote-cli-readonly-gate.md), based on `master` `20a1fb7c2487665c4d9749094d4fadd4ddba6b7a`. **Only authenticated remote migration-list read is authorized, not remote writes.**

- [x] Supabase project-specific OAuth/MCP read-only `list_migrations` confirms only applied foundation `20261113233720`, catalog `20261117213614` not applied
- [x] Supabase CLI v3 `--remote=<project-ref>` syntax checked in official v3 docs; exact CLI 3.1.0 already exercised offline in E1 CI
- [x] Operator-only `scripts/e1-h5-remote-history-readonly.sh --read-only` prepared with explicit ref, expected migration/hash guards and no write commands
- [x] Fake-CLI offline regression added to CI (no actual hosted credentials in GitHub Actions)
- [ ] Exact-HEAD CI and Codex review of this PR; owner authorization for document/script merge
- [x] **CLI remote execution in owner's Ubuntu/WSL (2026-11-18)** using Supabase CLI 3.1.0; Local/Remote columns match foundation applied + catalog pending, independently cross-checked via MCP
- [x] H5 migration-version columns independently reconciled (`CLI_REMOTE_HISTORY_VERIFIED`); neither migration push nor ledger repair performed
- [ ] H5 **auth side-effect deviation:** CLI v3.1.0 can POST `/cli/login-role` with `read_only:false`; short-lived `cli_login_postgres` role observed post-run. R1 guards/re-review pending; no repeat CLI or role cleanup authorized
- [x] H5 R2 local remediation: reject `SUPABASE_WORKDIR` override; pin exact CLI `--workdir`, reject unreviewed stack-mode link, parse ONLY `SUPABASE_DB_PASSWORD` from ignored `.env` with Node (no shell sourcing), require mode 0600/untracked, ignore `supabase/.temp/`
- [x] H5 R2 exact-HEAD CI PASS and Codex P1 on profile-resolution identified; original `SUPABASE_WORKDIR` P1 thread **resolved** after user authorization
- [x] H5 R3 implement explicit builtin `--profile supabase`, reject ambient foreign `SUPABASE_PROFILE` and add simulated persisted `SUPABASE_HOME/profile` + environment adversarial regressions
- [ ] H5 R3 exact-HEAD CI, independent Codex review and remaining profile P1 thread disposition, separate human merge approval; **no remote CLI rerun**
- [ ] H6 role/security, H10 physical/org metrics, H7/H11/H12/E2 remain independently gated

## Step E2 — Ingestion orchestration (expected #11b)

- [ ] Runtime PgVector with constructor `disableInit: true`; PgVector not registered in `new Mastra({ vectors })`
- [ ] Namespace-required adapter wrapper (SPEC §9.4)
- [ ] Publication transaction, visibility rule, GC and delete (§11.4.1, §11.5)
- [ ] Synchronous operator ingestion route (`401` anonymous)
- [ ] Local `pgvector/pgvector:pg17` CI service; all SPEC §11.4 scenarios tested (including content reversion)
- [ ] Log capture: no chunk text, query text or secrets
- [ ] CI green, review, human merge

## Step F — Retrieval and evaluation baseline (expected #12)

- [ ] Retrieval service + operator route; scope derived from principal
- [ ] Empty-result behaviour tested
- [ ] Gold set v1 (~40 queries) human-reviewed; holdout frozen
- [ ] Metric functions tested against hand-computed fixtures
- [ ] Owner-approved first ingestion of the corpus
- [ ] Calibration grid executed; baseline report committed
- [ ] Latency p50/p95 measured from the deployed environment
- [ ] Recall@5 target ratified or adjusted by the owner
- [ ] CI green, review, human merge

## E1 — H6/H10 read-only evidence preparation (PR Draft after #19, 2026-11-18)

Reference: [H6/H10 evidence-readiness note](../../docs/rag/e1-h6-h10-readiness-gate.md). The actual H5 CLI historian result is **VERIFIED**, and PR #19 was merged/deployed. Historical unchecked H5 items above are superseded by the verified PR #19 outcome; they are not new authorization requests.

- [x] Read-only recheck: foundation present, catalog absent, `rag_app` absent, no `rag` tables, project DB 11,228,851 bytes; two existing H6 security WARNs persist
- [x] Free organization project inventory reconfirmed: 3 projects, 2 inactive; aggregate organization bytes **NOT AVAILABLE**
- [x] Created offline H6/H10 evidence-envelope validator, with synthetic negative tests, no provider calls and explicit `hostedWritesAuthorized:false`
- [ ] Exact-HEAD CI PASS and independent Codex review on this Draft; human merge authorization
- [ ] H6 equivalent isolated PostgREST/security review and separate human revoke-or-accept decision; no hosted security changes
- [ ] H10 provider organization usage including inactive projects, physical disk/WAL and representative corpus measured; transactional concurrent admission proven before E2
- [ ] H7/H11/H12; all individual remote role/DDL/space/DSN/embedding/E2 gates **remain blocked**
- [x] H10 `NO_BACKUP_MVP` remains in force; no new backups or recovery commitments

## E1 — H6 isolated PostgREST and H10 official telemetry mapping (PR Draft after #20, 2026-11-18)

Authority: [H6 isolated assay](../../docs/rag/e1-h6-postgrest-isolated-assay.md), [H6 unratified disposition proposal](../../docs/decisions/RAG-E1-H6-security-disposition-proposal.md), [H10 official source map](../../docs/rag/e1-h10-telemetry-source-map.md). Baseline master bcdab1c3fa05c09ba3f74739ee16723e82621e3a (PR #20 merged/deployed).

- [x] Read-only hosted function definition and event trigger examined, exact function pg_get_functiondef SHA-256 recorded; no hosted privilege changes
- [x] New isolated PostgREST HTTP/RPC assay staged for disposable PG17 with synthetic auth controls and before/after **local-only** REVOKE regression
- [x] Identified official organization Usage, Database Settings/Infrastructure, Reports and Metrics API evidence sources; 2 inactive projects remain untouched
- [ ] New Draft exact-HEAD CI (real PostgREST synthetic HTTP), P0/P1/P2 independent Codex review and human merge authorization
- [ ] Reconcile isolated HTTP results and PostgREST version/config parity before human H6 security choice
- [ ] Separate owner H6-S1 targeted hosted privilege remediation OR H6-S2 explicit residual risk acceptance; neither is now ratified
- [ ] H10 owner-produced org-period aggregate, physical used/total/WAL and representative corpus; concurrency reservation enforcement before live E2
- [ ] Explicit human approval for every future hosted role/grant/DDL/space/DSN/ingest; H7/H11/H12 remain open
- [x] H10 NO_BACKUP_MVP unchanged; no real backup/restore or provider spending introduced

## E1 — H6 Security Adjudication (after PR #21 merged/deployed, 2026-11-18)

Authority: [Security adjudication](../../docs/decisions/RAG-E1-H6-security-adjudication.md) and [restricted operator decision package](../../docs/rag/e1-h6-security-operator-decision-package.md). **Owner ratified H6-S1 directional scope and explicitly authorized documentary PR #22 merge on 2026-11-18; no hosted execution approved.**

- [x] PR #21 isolated PostgREST assay merged into master, post-merge CI 153/153 PASS, user-confirmed deploy health.
- [x] Hosted read-only ACL/catalog re-observed: public.rls_auto_enable() SHA unchanged; postgres owner; enabled ensure_rls; explicit EXECUTE to PUBLIC/anon/authenticated/postgres/service_role; both WARNs persist.
- [x] Decision matrix H6-S1 narrowly revoke PUBLIC/anon/authenticated vs H6-S2 documented risk acceptance; PM recommendation H6-S1.
- [x] Drafted SELECT-only metadata preflight and separately gated future operator procedure; no hosted SQL writes.
- [x] Original exact-head CI and independent Codex code review PASS at `b21715d2dc2a95f843138d579ea1529f82d2c9fd`; owner authorized documentary merge. **Updated ratification HEAD requires fresh exact-HEAD CI and review before merge.**
- [x] **Distinct human H6-S1 directional ratification** (owner: “Ratifico tudo.”, 2026-11-18); S2 was not selected, and hosted SQL remains independently blocked.
- [ ] **Pending distinct second authorization** for target-confirmed hosted `REVOKE` and independent postcondition/advisor recheck; no silent rollback or execution by CI.
- [ ] If S2: owner rationale/review trigger/decision record and explicit acceptance of unresolved WARNs.
- [ ] H6 rag_app, H5 catalog, H10 org/disk/WAL, H7/H11/H12, E2 all remain blocked pending separate decisions.

## E1 — Owner overrides and hosted H6-S1 completion (2026-11-18)

Authority: [Free-tier MVP H10 cancellation and H6-S1 execution record](../../docs/decisions/RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md). This section **supersedes older unchecked H10 and H6-S1 operations** in this historical checklist; retain older entries as dated evidence, not active TODOs.

- [x] Owner **canceled H10 for the MVP**; organization-wide and physical disk/WAL measurements, projected capacity requirements, and old H10 threshold/admission constraints are **NOT CURRENT GATES**. Do not ask for their completion before E2.
- [x] Supabase organization `Alquem.io` confirmed **Free**. No subscription upgrade, project restoration, paid monitoring or new provider spending authorized.
- [x] Owner separately authorized hosted H6-S1 `REVOKE EXECUTE` from `PUBLIC`, `anon`, `authenticated`; preflight matched pinned function checksum and all expected ACL/trigger properties.
- [x] Hosted H6-S1 scoped REVOKE executed transactionally. Independent catalog postflight: only `postgres`/`service_role` retain EXECUTE; function hash and `ensure_rls` unchanged; security advisor returned **0 findings**.
- [x] H10 `NO_BACKUP_MVP` continues independently; no backups/restore or new paid plan.
- [ ] This documentation/evidence PR: exact-HEAD CI, independent review and separate human merge approval. No hosted operations in CI.
- [ ] `rag_app`, catalog/space migrations, DSN, H7/H11/H12, live embeddings and E2 remain subject to their independent gates; **none is H10 telemetry**.

## E1 — H6 rag_app pre-catalog provisioning preparation (2026-11-18)

Authority: [role operator runbook](../../docs/rag/e1-h6-rag-app-provisioning.md) and [Free MVP H10 cancellation](../../docs/decisions/RAG-E1-H10-free-mvp-cancellation-and-h6-execution.md). Scope: new Draft preparation only; remote role creation, password and DSN are separate human gates.

- [x] Fresh project-specific read-only Supabase preflight: `rag_app` absent, `postgres` can create roles, SCRAM-SHA-256, `rag`/extensions/vector present, foundation applied, catalog absent, H6-S1 in force, plan Free.
- [x] Operator-only transactional candidate `CREATE ROLE rag_app LOGIN NOINHERIT ... PASSWORD NULL` plus `USAGE ON SCHEMA extensions`, with preconditions, postconditions and no secret.
- [x] New SELECT-only preflight/postflight queries, dedicated disposable PG17 test, fail-closed replay and denied private DDL.
- [ ] Exact-head CI, independent Codex review, human merge approval for preparation PR.
- [ ] **Separate owner authorization H6-R1** for actual hosted role creation and minimum extension USAGE only; **not granted by this request**.
- [ ] **Separate owner authorization H6-R2** for protected interactive `\password rag_app`, successful authentication probe, and secure secret custody. Never paste credentials into chat/PR/SQL/CI.
- [ ] **Separate** H5 catalog migration, vector space, app DSN, H7/H11/H12/E2 gates. **H10 canceled** for MVP Free; NO_BACKUP_MVP preserved.

## E1 — H6-R1 hosted rag_app creation and independent verification (2026-11-18)

Authority: [hosted execution receipt](../../docs/rag/e1-h6-r1-hosted-execution-receipt.md), original candidate reviewed in PR #24. This section supersedes older unchecked pre-H6-R1 actions; **do not replay role creation**.

- [x] Owner specifically authorized `E1_H6_R1_HOSTED_ROLE_CREATION` for target `lmocjhpajhxegzobydau` (Free).
- [x] Fresh hosted read-only preflight passed: `rag_app` absent, PG17, SCRAM, foundation present, catalog absent, H6-S1 active; `PUBLIC` CREATE grants absent in `public`, `rag`, `extensions`.
- [x] Executed the **exact SQL from merged PR #24** once, transactionally creating `rag_app` with minimal flags, `PASSWORD NULL` and only `USAGE ON SCHEMA extensions`.
- [x] Independent read-only postflight: `role_count=1`, flags minimal, no memberships/ownership, `extensions_usage=true`; `extensions_create=false`, `rag_usage_before_catalog=false`, `rag_create=false`, `public_create=false`, `catalog_table_count=0`. Supabase Security Advisor `lints=[]`.
- [ ] Evidence-only documentation PR: exact-HEAD CI, Codex review, human merge/deploy approval. No additional hosted mutations.
- [ ] **Separate H6-R2 human authorization** to set password interactively and perform authentication-only proof; never surface secrets.
- [ ] **Separate H5 catalog, space, DSN, H7/H11/H12 and E2 approvals**. H10 remains canceled for the Free MVP; `NO_BACKUP_MVP` unchanged.

## E1 — H6-R2 authorization and protected credential handoff (2026-11-18)

Authority: [H6-R2 preflight and operator handoff](../../docs/rag/e1-h6-r2-credential-protected-handoff.md). Owner explicitly authorized `E1_H6_R2_CREDENTIAL_PROVISIONING`. This authorization **does not** mean the remote role password has been set.

- [x] Verified provider project `lmocjhpajhxegzobydau` on Alquem.io **Free**, `rag_app` exists with minimal role flags and only `extensions` USAGE; no H5 catalog, no `rag` grants; Security Advisor `lints=[]`.
- [x] Read-only hosted logging parameters (defaults `ddl/error/warning/top/none`) and verified reversible, transaction-local settings `none/panic/fatal/none/none` via real `BEGIN; SET LOCAL ... ROLLBACK;` **without a password**; independently confirmed defaults restored.
- [x] Identified documented provider log exposure for SQL-literal and failed password statements; **no password, verifier or role-password operation submitted to remote SQL tools**.
- [x] Documented TLS-verified interactive `psql \password rag_app` transaction procedure, per-session log safety checks, secret handling and fresh custom-role authentication proof.
- [ ] Exact-HEAD CI, independent Codex review and human merge approval for this **documentation-only handoff**.
- [ ] **Human operator must finish the authorized interactive credential operation** in a trusted WSL session; collect only sanitized success or failure, never the secret itself.
- [ ] **Independent login-as-rag_app test** with protected secret prompt `H6_R2_AUTH_PASS`. Do not claim H6-R2 COMPLETE before both steps.
- [ ] Separate H5 catalog, vector space, DSN, H7/H11/H12 and E2 gates; H10 canceled for Free MVP, `NO_BACKUP_MVP` unchanged.


## E1 — H6-R2 credential provisioning closed and independently authenticated (2026-11-18)

Authority and evidence: [H6-R2 protected operator handoff, final closure §0](../../docs/rag/e1-h6-r2-credential-protected-handoff.md). This section **supersedes the earlier pending credential/auth steps** while preserving the original runbook and security guard.

- [x] Owner used a protected interactive `psql 17.10` terminal with TLS verification to PostgreSQL 17.11, rechecked administrator identity and the complete minimal role contract.
- [x] Validated 5 transaction-local logging mitigations, entered `\\password rag_app` into protected prompts only, `H6_R2_TRANSACTION_HEALTHY` passed, then `COMMIT` succeeded; post-commit defaults `ddl` and `warning` restored.
- [x] New **independent TLS-verified password-authenticated connection** as `rag_app` returned `H6_R2_AUTH_PASS`; no secret/verifier was shared in chat, repository, SQL literal or CI.
- [x] Provider-scoped post-auth SELECT-only postflight unchanged: minimal role flags/privileges intact, no memberships/ownership/extra CREATE, catalog still absent; Security Advisor `lints=[]`; project `ACTIVE_HEALTHY`.
- [x] **H6-R2 credential and authentication operational gate COMPLETE / VERIFIED.** No additional password change is needed to close this gate. Do not re-run role creation or `\\password` as part of documentation publication.
- [ ] Evidence-only PR #26 updated to this final operational status: exact-HEAD CI, Codex independent review (including prior P2 reconciliations), and separate owner merge/deploy gate.
- [ ] **Separate authorization required:** H5 catalog migration, vector space, application DSN, H7/H11/H12 and E2 ingestion. H10 remains canceled for Supabase Free MVP and `NO_BACKUP_MVP` remains unchanged.

## E1 — H5 hosted catalog applied and independently verified (2026-11-18)

Evidence: [H5 hosted CLI execution + postflight receipt](../../docs/rag/e1-h5-hosted-catalog-execution-receipt.md). This **supersedes** older pending H5 and pre-catalog notes without erasing their history.

- [x] Explicit owner H5 authorization. CLI v3.1.0 private WSL `--dry-run` returned exact project `lmocjhpajhxegzobydau`, sole pending `20261117213614_rag_catalog.sql`, no foundation replay.
- [x] Private operator `db push --remote=lmocjhpajhxegzobydau --skip-vault` with reviewed interactive Yes on exactly 1 migration; CLI reported success; environment password cleared.
- [x] Independent hosted ledger check: versions `20261113233720`, `20261117213614` only; 38 catalog ledger statements; PG17.11 ACTIVE_HEALTHY.
- [x] Independent catalog postflight: nine `rag` tables, RLS on all nine, nine `rag_app` policies, nine privileged `postgres` owners; minimal role flags/zero membership; `rag` USAGE without CREATE; `embedding_space` SELECT-only, DML on other eight; API roles denied.
- [x] All nine catalog row counts zero, no vector table, H6-S1 unchanged, Supabase Security Advisor `lints=[]`.
- [x] H5 operational closure: `E1_H5_HOSTED_CATALOG_MIGRATION = COMPLETE / VERIFIED`, with **no automatic further catalog writes**.
- [ ] Document receipt PR exact-HEAD CI, Codex review and human merge/deploy gate; this is separate from the already-completed remote catalog operation.
- [ ] Investigate INFO-only Performance Advisor: eight unindexed FKs and five unused indexes after catalog creation, before meaningful workload; no extra DDL authorized.
- [ ] Independently authorize and review vector flat space, namespace RLS/grants, runtime DSN, H7/H11/H12 and E2; H10 canceled for Free MVP, `NO_BACKUP_MVP` unchanged.

## E1 — H6 hosted flat vector provisioned (2026-11-18)

Evidence: [H6 vector hosted execution receipt](../../docs/rag/e1-h6-vector-space-hosted-receipt.md). This **supersedes** older statements that H6 vector provision is pending, without erasing historical checkpoints.

- [x] Owner explicitly authorized `E1_H6_VECTOR_SPACE_PROVISIONING`.
- [x] Fresh provider preflight: correct project/PG17/Free; H5 ledger 2 exact versions, 9 tables and catalog rows 0; space absent, H6-S1/role minimal intact.
- [x] Atomic, precondition-guarded hosted operator SQL equivalent to pinned `@mastra/pg` 1.35.0 flat table/index shape; 1536-dimensional `extensions.vector`, no ANN; registry status `building`. **Implementation is not a direct JavaScript createIndex call; architecture-method review pending.**
- [x] Independent postflight: 10 RLS-enabled `rag` tables/owners `postgres`, 3 namespace=`public` vector RLS policies, `rag_app` SELECT/INSERT/UPDATE and sequence USAGE only, DELETE denied, no API-role access, zero vector data; H5 ledger and H6-S1 unchanged; Security Advisor zero findings.
- [ ] Codex independent adjudication of operator-SQL vs original `PgVector.createIndex` mechanism and migration-ledger boundary; no retroactive history repair.
- [ ] Exact-head CI, independent Codex review, and human approval to merge this receipt/test-alignment PR; no automatic deployment.
- [ ] Runtime DSN, vector live client connectivity, H7/H11/H12, E2 ingestion and paid embeddings all **separately gated**. H10 canceled for Free MVP; `NO_BACKUP_MVP` preserved.


## E1 — Runtime PostgreSQL DSN (owner-authorized read-only integration, 2026-11-18)

Evidence / work order: [E1 runtime DSN read-only integration](../../docs/rag/e1-runtime-dsn-readonly.md).

- [x] Owner authorized `E1_RUNTIME_DSN_INTEGRATION` (connection/SELECT-only; no E2, DDL or embeddings).
- [x] Confirmed H5/H6 hosted project and prepared lazy runtime configuration restricted to `rag_app.<project-ref>`, the approved session pooler host/port and `sslmode=verify-full`; hosted CA required.
- [x] Prepared enhanced authenticated internal readiness + private `db:check` SELECT-only probe for real `current_user=session_user=rag_app`, 1536-vector layout, `public` namespace RLS and no admin privileges.
- [x] Existing Mastra/Turso infrastructure and `disableInit:true` retained; no public vector registration, hosted environment variables or live database connections executed by code changes.
- [ ] Exact-HEAD PR CI and independent Codex review; human merge/deploy approval.
- [ ] Owner-only configuration of *server-side* Mastra Platform secrets `POSTGRES_CONNECTION_STRING` (rag_app) and `SUPABASE_CA_CERT_BASE64`; never log, paste or commit values.
- [ ] Real protected `rag_app` credential/TLS/authenticated internal readiness proof; fresh Supabase SELECT-only postflight. **Do not mark runtime DSN COMPLETE merely from CI or generic /health.**
- [ ] H7/H11/H12, E2 ingestion, vector write/read APIs each separately approved; H10 canceled and `NO_BACKUP_MVP` unchanged.
