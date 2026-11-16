# RAG07 — Stage A partial owner ratification

| Field | Decision |
| --- | --- |
| Date | 2026-11-16 |
| Authority | Project owner, explicit instruction to execute Stage A in project conversation |
| Base architecture review | PR #7; baseline candidate `634a07f89883bd52b42c9007ae9eb2cbd4563ae1` |
| State | **STAGE_A_PARTIALLY_RATIFIED**; architecture acceptance is narrower than implementation authorization |
| Source documents | [ADR](../architecture/ADR-rag-ingestion.md), [SPEC](../specs/SPEC-rag-ingestion.md), [plan](../../tasks/rag-ingestion/plan.md) |

## Ratified scope

| ID | Decision | Exact authorization boundary |
| --- | --- | --- |
| **H1 — ACCEPTED_FOR_MVP** | Public Brazilian LGPD (Lei 13.709/2018) and a small curated set of official CD/ANPD resolutions, with sources, versions and legal units cited | Exact resolution manifest, canonical URLs and current legal texts **must be verified and frozen in Step B**; no live ingestion authorized |
| **H2 — ACCEPTED_FOR_MVP** | HTML as the primary format; Markdown and plain text for deterministic fixtures and supported inputs | No PDF, OCR, scanned records, private uploads or arbitrary external URLs in MVP |
| **H3 — BASELINE_ACCEPTED / ACCOUNT_PENDING** | `openai/text-embedding-3-small` at 1536 dimensions, cosine, as the **initial technical evaluation baseline** | No billing, external embeddings calls, API key changes or provider-account approval. Google is a comparison/fallback candidate only. Model quality is unverified pending the gold set. Provider-side limit and per-job cap remain gated by **H11** |
| **H9 — CONDITIONAL / DEPENDENCY_REVIEW_ONLY** | Evaluate an HTML parser, tokenizer, and direct schema-validation dependency if justified during offline PRs | **No package is preapproved for installation.** Each addition needs version, license, maintenance/security and bundle-cost review, exact lockfile diff, CI, and project-owner approval within its own PR; pure Node alternatives preferred when sufficient |

## Ratified architectural principles — not physical implementation

The owner accepts the following **principles** as the design direction, without approving the detailed DDL, migrations, production access model, data deletion policies or live execution:

- **D4 — PRINCIPLES_ACCEPTED:** Supabase private `rag` owns RAG catalog and vectors; Mastra PgVector maintains per-space vector tables, with an application catalog as publication authority; exact (`flat`) search initially; runtime never owns DDL; Turso remains exclusively Mastra runtime storage. **H4** remains pending for physical schema, constraints, RLS, indexing and grants.
- **D5 — PRINCIPLES_ACCEPTED:** deterministic IDs and idempotent ingestion; versioned builds; atomic publication visibility; reindex into a new space when the embedding model changes; publication/GC must serialize to avoid stale or deleted results. **H12** remains pending for exact retention windows, erasure guarantees and GC authorization.
- **D6 — PRINCIPLES_ACCEPTED:** retrieval limited to published data, with provenance/citations, explicit namespace and server-side authorization; exact search first; quality measured on a human-reviewed legal-unit gold set, with Recall@5 as the principal metric. `topK=5` and `~40` questions are initial calibration hypotheses, **not a performance guarantee**. **H7** remains pending for production access authorization; **H8** for deployment latency.
- **D2 — EXPERIMENTAL, NOT FULLY RATIFIED:** structural legal-unit chunking, 512-token initial cap and recursive baseline may be prototyped offline and measured. The actual chunking profile remains subject to evaluation rather than being adopted as final quality policy.

## Permitted now

- Finish and review **documentation** in PR #7.
- After PR #7 receives its own CI/review and owner merge authorization, prepare **Step B** source manifest, pure TypeScript contracts, canonical deterministic identifiers, allowlist/validation and synthetic fixture tests in a separate Draft PR.
- After Step B approval, prepare **Step C** offline extraction/normalization/chunking using committed synthetic or authorized source snapshots. Network-free CI, no secrets, paid services or database operations.
- Mock embeddings and provider interfaces **offline** only; keep production model use gated.

## Explicitly withheld

| Gate | Status | Blocks |
| --- | --- | --- |
| H4 | PENDING | Physical database model and schema/migration approval |
| H5 | PENDING | Applying any SQL migrations |
| H6 | PENDING | Creating `rag_app`, grants/role changes, rotating DSN |
| H7 | PENDING | Operator API deployment, retrieval/ingestion endpoints in production |
| H8 | PENDING | Region/latency acceptance before hosted retrieval |
| H10 | PENDING | Backup/PITR/storage suitability before persistent ingestion |
| H11 | PENDING | Any paid embedding call or production evaluation budget |
| H12 | PENDING | GC grace, physical erasure and retention policy |
| H3 account dimension | PENDING | Provider credentials or billing setup |
| H9 exact packages | PENDING | Installation of specific third-party runtime packages |

Do **not** merge PR #7, deploy, install dependencies, execute DDL, change Supabase or Turso, run paid embeddings, or open a production ingestion route on the strength of this record. PR #7 remains Draft until the modified HEAD has passed CI and an independent review and receives a separate merge authorization.

## Required handoff to Step B

A Step B Draft PR must be based on the approved specification after PR #7 is merged. It must keep every test offline, validate H1 source URLs/license against official publications, use no automatic production fetch, and include exact SHA-256 golden fixtures, URL/host/redirect security tests, media sniffing and fixed error-code contracts. Any ambiguity is documented as a human gate rather than silently expanding the corpus.
