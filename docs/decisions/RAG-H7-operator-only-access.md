# H7 — Operator-only operational access (MVP)

**Prepared on 2026-11-19; owner directed execution of H7.** This is an operator-access decision proposal plus code hardening; **H7 is not closed merely by merge, authenticated Supabase readiness or a masked secret inventory**. Keep this in a Draft PR pending exact-HEAD CI, independent Codex/security-focused review and a separate human release decision.

## 1. Authorized access model

| Boundary | MVP decision / requirement |
| --- | --- |
| Ingestion | **Operator-only**, no endpoint created in H7; require `server.auth` and route `requiresAuth:true` before later E2 work |
| Retrieval | **Operator-only** in MVP; no anonymous, public demo or reader token during H7 |
| Principal | One `rag-operator` identity, supplied by private `RAG_SERVER_API_TOKEN`; Mastra `role:'admin'` is **application identity**, not PostgreSQL privileges |
| Web UI / organization | Platform login/organization membership is distinct from the API bearer token; Studio uses Platform SSO plus application controls; org members may access project settings according to their org roles |
| Database | Server-side `rag_app` only; `POSTGRES_CONNECTION_STRING` uses session pooler + `verify-full` and explicit CA. Never use `postgres` or `service_role` from the server |
| Vector | Do not register `PgVector` in `new Mastra({vectors})`; no built-in vector mutation/search routes. `disableInit:true` unchanged |
| Token transport | Bearer in HTTPS for operator probes, never URL/query parameter, logs, Git, issue, CI artifacts or copied diagnostic text |
| Public API | No additional RAG endpoints, reader credentials, tenant access or paid model invocation until separately approved gates |
| Runtime durability assay | Internal Turso probe remains disabled unless separately enabled for a bounded operator assay; none enabled by H7 |

H7 selects the recommendation in [ADR H7](../architecture/ADR-rag-ingestion.md): **operator-only ingestion/retrieval now; reader/demo later**. The exact implementation of future ingestion/retrieval routes still needs its own code review and E2 authorization. The existing `SimpleAuth` provider is **documented as development/testing-oriented** by Mastra; this H7 PR does not convert it into a production-grade identity provider or claim MFA, expiring tokens, scoped OAuth, rate limits or audit records that are not implemented. Its use in the current operator-only deployment is a residual risk to be **explicitly accepted or remediated** before H7 is marked COMPLETE.

## 2. Evidence and code guard (no secrets inspected)

- Baseline `master`: `8608048414d2f80b40eb8e109e3a04b5f7a8b106`; E1 hosted authenticated readiness was independently reported by the owner as `HTTP 200 / {"status":"ok"}`, and local `db:check` passed with `rag_app` and TLS verified.
- `server.auth` is configured in `src/mastra/index.ts` using `SimpleAuth`, which requires `RAG_SERVER_API_TOKEN` when hosted and binds the token to a single `rag-operator` principal. Readiness and Turso durability routes require authentication.
- **H7 security hardening:** construct the token lookup as a *null-prototype object* because SimpleAuth performs direct `tokens[requestToken]` lookup. Ordinary JS object inheritance can cause reserved names (e.g. `constructor`, `__proto__`) to resolve to truthy inherited properties. Tests reject these inputs via Bearer, `X-Playground-Access` and cookie; normal configured operator tokens continue to work.
- Production bundle smoke verifies anonymous, incorrect and prototype-key tokens return HTTP **401** for readiness. CI uses a synthetic token and no hosted Supabase credentials; it must never claim live authorization from CI.
- No additional live RAG routes or public vector registration were introduced, and no database DDL, model calls or ingestion performed.

## 3. Hosted variable inventory — name-only

Authenticated Mastra Platform environment **production** contains these names (values remained masked during audit):

| Name | H7 disposition |
| --- | --- |
| `POSTGRES_CONNECTION_STRING` | **KEEP**, constrained to `rag_app` (live readiness passed) |
| `SUPABASE_CA_CERT_BASE64` | **KEEP**, verified CA for TLS `verify-full` |
| `RAG_SERVER_API_TOKEN` | **KEEP** as operator-only secret; plan rotation and trusted custody |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | **KEEP**, Mastra Platform-managed runtime storage variables; managed values take precedence |
| `SUPABASE_DB_PASSWORD` | **REMOVE from production runtime after owner verifies no consumers**. GitHub code search finds references only in scripts/docs, **none in `src/`**. Preserve operator-only admin credential in a private manager outside Mastra runtime |
| `OPENAI_API_KEY` | **REMOVE from production runtime until H11** unless the owner demonstrates an approved separate consumer. No live E2 embeddings or provider charge is authorized |

**No secret value was requested, viewed, printed, stored or changed.** Mastra Platform member/admin roles may edit environment variables; review organization membership and any access tokens as a separate operator gate. Removing or rotating secrets is potentially disruptive; **the human owner performs it through the private platform UI after reviewing dependencies**, not automatically in this PR. The code and CI require no admin DB password or OpenAI key.

## 4. Manual operator-only gates — privacy-preserving

1. In [Mastra production Environment Variables](https://projects.mastra.ai/jefferson-4a68/mastra-rag-d7b8/settings/environment-variables), review **names and owners, never reveal values in chat**. Keep only strictly required runtime credentials. Confirm via independent review that H5 CLI scripts are executed from private operator WSL, not by the hosted Mastra server, before removing `SUPABASE_DB_PASSWORD`.
2. In [Mastra Platform org Team settings](https://projects.mastra.ai), confirm the authorized owner/operator accounts, no unknown/invited member, and correct org roles. Per [Mastra Team docs](https://mastra.ai/docs/mastra-platform/team-members), Members can edit variables and deploy; Viewers cannot. Keep a private access inventory, no names/emails in PR.
3. Review Mastra Platform access tokens and audit token ownership. The application `RAG_SERVER_API_TOKEN` is **not interchangeable** with Mastra CLI/organization access tokens, nor with Supabase DB passwords. Ensure operator API token is at least 32 characters, unique, privately stored, not copied to logs or URL.
4. After human-controlled secret cleanup, restart/redeploy `production` and run a sanitized authenticated GET on `https://mastra-rag-d7b8.server.mastra.cloud/internal/readiness/supabase`: `HTTP 200 / {"status":"ok"}` must continue to pass. Also prove missing and invalid bearer credentials are **401** (no body/secret captured), and that the H7 `__proto__`/`constructor` negatives are rejected.
5. For single-token rotation, first provision a **new** strong operator token in the private production secret store under the same variable, apply/redeploy, verify the new token gives 200, and verify the old token is rejected. This deliberately introduces a cutover; there is **no dual-token overlap** in the MVP. Record times/status only. Do not rotate without a separate operator change window/authorization.
6. If compromise is suspected, revoke the credential in the provider/secret store and apply a controlled deploy, then audit accesses; don't put a real token in issue comments. If `SimpleAuth` residual risk cannot be accepted, replace it with reviewed production-ready authentication under a separate PR **before** new ingestion/retrieval APIs.

## 5. Stop conditions / H7 acceptance

- Any anonymous, invalid, `constructor` or `__proto__` credential can reach a protected route or mutate state.
- Unexpected organization members/token owners, uncontrolled management roles, leaked secrets, failed 200 authenticated readiness after cleanup, RLS/CA downgrade, or platform-owned variables shadowing operator expectations.
- Missing exact-HEAD CI or independent review; unauthorized secret rotation/deletion; H11/H12/E2 changes bundled into H7.
- **Do not mark H7 COMPLETE** until independent review, human merge/deploy and production negative/positive auth plus privileged-secret cleanup/disposition and explicit acceptance/replacement of `SimpleAuth` are reconciled.

**State:** `H7_OPERATOR_ONLY_CANDIDATE / CODE_REVIEW_PENDING / SECRETS_OWNER_GATE / E2_BLOCKED`. **H10 Free MVP `NO_BACKUP_MVP` remains in force.**
