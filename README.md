# mastra-rag

Mastra TypeScript project for a future document-grounded RAG using [Supabase PostgreSQL / pgvector](https://supabase.com/docs/guides/ai) and [Mastra PgVector](https://mastra.ai/integrations/vectors/pg).

## Status

**PR #2 scope: database foundation only.** There are no agents, ingestion pipelines, embeddings, or vector indexes yet.

- The existing Mastra Cloud project association is preserved.
- The Supabase project is `lmocjhpajhxegzobydau` in São Paulo.
- The private `rag` schema and the `vector` extension (in `extensions`) were prepared previously.
- `src/mastra/storage/supabase-vector.ts` contains a lazy, server-only factory with a two-connection PostgreSQL pool.
- `scripts/check-supabase.ts` runs a **read-only** check for extension, schema, and denied public role access. It creates nothing.

## Development

Node.js >= 22.13.0 and npm are required.

```bash
npm ci
npm run test
npm run typecheck
npm run build
npm run dev
```

Mastra Studio runs at `http://localhost:4111`; no agents will appear until a later PR implements them.

## Connecting the Supabase database (server only)

1. Open the [Supabase project's Connect dialog](https://supabase.com/dashboard/project/lmocjhpajhxegzobydau) and select **Session pooler** (port `5432`). Do not guess the pooler host.
2. Copy `.env.example` to `.env` and replace the host and URL-encoded password. Append `?sslmode=require` to enforce encryption. For server verification, prefer `sslmode=verify-full` with the correctly installed Supabase CA certificate.
3. Run `npm run db:check`. This command requires `.env`, connects to Postgres, issues one read-only SELECT and disconnects. It does not create or alter anything.
4. For Mastra Cloud, supply `POSTGRES_CONNECTION_STRING` through the cloud project's **server-side secrets/settings**, not Git or a public endpoint.

Supported connection targets: the configured project's direct host or Supabase **session** pooler on port 5432. Transaction-mode pooler (6543) is intentionally rejected by this foundation because subsequent RAG operations may require session semantics.

The connection string grants database access. Never share it in issues, logs, frontend code, or PR comments. Restrict the deployment's database credentials to a dedicated least-privilege role before exposing ingestion publicly. This foundation does not create a database role.

## Validation

`npm run test` uses the Node test runner and requires no database secrets. The live database check is deliberately not part of PR CI.

```bash
npm run db:check
```

This reports success only if pgvector exists in `extensions`, the schema `rag` exists, and neither `anon` nor `authenticated` has direct `USAGE` privileges on it.

If the check fails, it reports a **sanitized diagnostic category** such as `AUTHENTICATION`, `NETWORK`, `TLS_CERTIFICATE`, or `FOUNDATION`. Raw database exceptions and connection strings are deliberately not logged. The warning that `sslmode=require` may change semantics in future `pg` releases is separate from the failure: current `pg-connection-string` maps it to `verify-full`. You can use `sslmode=verify-full` explicitly after configuring the appropriate certificate trust chain. Never disable TLS verification as a workaround.

If you copied a database password with reserved URL characters, percent-encode those characters before inserting it in the connection string. Verify the **exact Session Pooler hostname and username** in Supabase Connect rather than assuming they match another project. For connectivity investigations, check that the local network can reach port 5432.


## Next milestones

Infrastructure gates are complete: Supabase foundation (PR #2), production readiness (PR #3), Cloud readiness diagnostics (PR #4), Supabase TLS remediation (PR #5) and Turso durability (PR #6).

PR #7 proposes the RAG ingestion architecture for human adjudication; nothing in it is implemented yet:

- Specification: [`docs/specs/SPEC-rag-ingestion.md`](docs/specs/SPEC-rag-ingestion.md)
- Architecture decisions D1–D6 (status `PROPOSED`): [`docs/architecture/ADR-rag-ingestion.md`](docs/architecture/ADR-rag-ingestion.md)
- Incremental plan and checklist: [`tasks/rag-ingestion/plan.md`](tasks/rag-ingestion/plan.md), [`tasks/rag-ingestion/todo.md`](tasks/rag-ingestion/todo.md)

Implementation starts only after the project owner ratifies those decisions. Keep application secrets out of the repository.


## Production Readiness (intermediate PR before ingestion)

**Runtime storage:** Mastra now uses `@mastra/libsql`, with the already attached managed Turso database on Mastra Cloud. Platform variables `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are injected automatically. The cloud process fails startup if either is missing; local development defaults to `file:./mastra.db`. Supabase pgvector is **independent** of this storage.

**API authentication:** All Mastra server routes use `SimpleAuth` with a private token `RAG_SERVER_API_TOKEN` (at least 32 characters). Generate one privately with `openssl rand -hex 32` and set it in Mastra Cloud production secrets **before deployment**. Without it, a Mastra Platform process fails to start; a local process with no token has zero valid credentials. Do not disable Mastra Platform's separate Studio sign-in: leave `MASTRA_PLATFORM_STUDIO_AUTH` unset.

**Cloud Supabase verification:** `GET /internal/readiness/supabase` is an authenticated, read-only endpoint. It verifies pgvector, the private `rag` schema and public-role isolation, returning only `200 {"status":"ok"}` or `503 {"status":"unavailable"}`. The platform's separate `/health` remains unchanged. After configuring the server token and `POSTGRES_CONNECTION_STRING` privately on the Cloud environment and deploying with approval:

```bash
curl -i https://mastra-rag-d7b8.server.mastra.cloud/internal/readiness/supabase
# Expect 401 without Authorization.
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer ${RAG_SERVER_API_TOKEN}" \
  https://mastra-rag-d7b8.server.mastra.cloud/internal/readiness/supabase
# Expect 200. A 503 blocks release.
```

**TLS gate:** Local `NODE_EXTRA_CA_CERTS` does not automatically propagate to Mastra Cloud. Validate the Supabase CA trust chain on the deployed runtime before considering 200 an accepted result. Do not disable hostname or certificate verification. Never disclose the DSN, token, or private configuration in build logs or PR threads.

**Release gates:** CI installation, tests, typecheck and build; independent Codex review; human merge authorization; configure Cloud environment secrets; verify Turso durability, anonymous 401 / authorized 200, authenticated Supabase readiness 200, and successful `/health`. Any missing gate blocks merge or deployment as applicable. No migration, new agent, vector index, or live DB mutation is included.

## Diagnosing Supabase Cloud readiness

The `GET /internal/readiness/supabase` route is **authenticated** and read-only. It checks the same PostgreSQL metadata as `db:check`, with a sanitized response:

- HTTP `401` without a valid operator bearer token (SimpleAuth middleware).
- HTTP `200` and `{"status":"ok"}` if the probe and disconnect succeed.
- HTTP `503` and `{"status":"unavailable","category":"CONFIGURATION"}` (or another fixed category) when the database check fails.

Categories are restricted to `CONFIGURATION`, `AUTHENTICATION`, `TLS_CERTIFICATE`, `NETWORK`, `FOUNDATION`, `DATABASE_PERMISSION_OR_NAME`, and `UNCLASSIFIED`. This uses the existing `describeDatabaseCheckFailure()` classifier. Categories are **diagnostic leads, not proof** of root cause. No exception messages, connection strings, hostnames, credentials, SQL text, or stack traces are returned. Public `/health` is unchanged.

After human approval for a separate merge and deploy, the operator can repeat the existing authenticated readiness request. If the result is `503`, inspect only `status` and `category` before deciding whether to change certificate trust. Never disable PostgreSQL TLS or server certificate verification.

This PR changes no secrets, environment variables, database objects, cloud configuration, indexing, or ingestion behavior.

## Supabase TLS remediation (PR #5; post-diagnostics)

On 2026-11-14 the deployed authenticated readiness endpoint classified the failure as `TLS_CERTIFICATE` while the local WSL check succeeded with the explicitly trusted Supabase CA. This supports a missing CA trust chain or hostname/certificate mismatch **in the Cloud runtime**, but the exact underlying driver code has not been exposed.

The `@mastra/pg@1.35.0` connection-string pool builder honors the explicit `ssl` configuration after parsing `sslmode`. The PgVector factory now accepts an **optional, per-pool** Supabase CA encoded in `SUPABASE_CA_CERT_BASE64` without modifying the process-wide Node.js trust store. When configured, it requires a valid single CA certificate, sets `rejectUnauthorized: true` and binds the TLS `servername` to the **validated** PostgreSQL hostname. HTTP/Mastra Studio, Turso and unrelated TLS connections remain unaffected. Without it, existing local `NODE_EXTRA_CA_CERTS` and default certificate trust remain unchanged.

### Operator provisioning for Mastra Cloud production

1. In the [Supabase project Database SSL configuration](https://supabase.com/dashboard/project/lmocjhpajhxegzobydau/settings/database), obtain and independently verify the *project's own* trusted CA certificate. The local verified file is `$HOME/.config/mastra-rag/supabase-ca.crt`. Check its fingerprint against the downloaded file, rather than sourcing CA material from a web snippet or an unrelated project.
2. On WSL, encode the **certificate only** as one base64 line (this is not the private key):
   ```bash
   base64 -w 0 "$HOME/.config/mastra-rag/supabase-ca.crt"
   ```
3. Store that output as a private **Production** environment variable named `SUPABASE_CA_CERT_BASE64` in Mastra Cloud. Do not insert it into the PostgreSQL connection URL. Do not commit it, paste it in PR comments, or send it in chats. Keep existing `POSTGRES_CONNECTION_STRING` with `sslmode=verify-full` (preferred) or the foundation-accepted `sslmode=require`; the explicit per-pool TLS options still enforce full verification.
4. Merge/deploy only after CI, independent review and human authorization. The platform may require restart/redeployment for environment variables to take effect. Keep the previous healthy deployment available for rollback.
5. Run the existing operator-authenticated `GET /internal/readiness/supabase` check. Require HTTP **200** `{"status":"ok"}` before unblocking Cloud database readiness. Check HTTP 401 without a bearer token, `/health`, and Studio as separate gates. If still 503, inspect **only** the fixed diagnostic category and stop for a new cause investigation.

### Safety / non-goals

No new service or Postgres database; no schema migration, vector index, agent or ingestion. No `rejectUnauthorized:false`, insecure `sslmode`, custom `checkServerIdentity`, CA pasted into source, or global trust-store mutation. This PR does **not** establish that the Cloud connection passed — it requires human environment configuration and an authorized real deployment test.

## Turso durability verification (PR #6)

The application configures persistent `LibSQLStore` on its Mastra instance, but production durability after a server restart must be tested separately. A temporary **operator-only, disabled-by-default** diagnostic is available for this purpose. It accesses the exact `mastra.getStorage().getStore('memory')` domain and creates one randomly generated Mastra thread, using a reserved resource ID. It does not create arbitrary SQL tables or modify Supabase.

### Enable and run (only after an approved PR merge/deploy)

1. Verify the attached managed Turso resource is **Ready** in Mastra Cloud. Set the *private Production environment* variable `TURSO_DURABILITY_PROBE_ENABLED=true`, while preserving the managed `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` values. The routes are disabled by default; they also reject file-backed storage. A server restart/redeploy may be necessary to apply the variable.
2. Using the operator's existing `RAG_SERVER_API_TOKEN` only in the private terminal, create one probe:

   ```fish
   curl --fail-with-body -sS -X POST \
     -H "Authorization: Bearer $RAG_SERVER_API_TOKEN" \
     https://mastra-rag-d7b8.server.mastra.cloud/internal/durability/turso/create
   ```

   Expect HTTP `201` JSON with `status:"created"`, `probeId`, `fingerprint` (SHA-256), `createdAt`. **Keep the complete receipt**, but do not post the token or actual Turso connection details in GitHub.
3. **Reboot only the Mastra Cloud runtime**, not the Turso database, via an authorized controlled restart. Confirm the new container and `/health` success in the deploy/runtime logs. Do **not** call the create route again.
4. On the new running process, read the same ID using `GET /internal/durability/turso/read?id=<probeId>` with the same authorization header. Expect HTTP `200`, `status:"found"`, and **identical** `probeId`, `fingerprint` and `createdAt`. A prior read on the same process does not satisfy the durability gate.
5. Remove only the probe: `DELETE /internal/durability/turso/delete?id=<probeId>` with the bearer token. Expect `200 {"status":"deleted"}`. A subsequent read should return `404 {"status":"not_found"}`.
6. Remove `TURSO_DURABILITY_PROBE_ENABLED` (or set it to `false`) from Production and restart/deploy according to the platform's normal procedure. Authenticated routes must again return `404 {"status":"disabled"}`; anonymous requests still return `401`.

If probe creation returns HTTP `503`, inspect **only the sanitized recovery fields**:
- `{"status":"unavailable","cleanup":"verified_absent"}`: the create confirmation failed but cleanup was confirmed; retry only after investigating the failure.
- `{"status":"unavailable","cleanup":"unconfirmed","probeId":"..."}`: cleanup could not be confirmed. Preserve the ID and retry the **DELETE** operator route later; it can remove a partial probe record with incomplete metadata, but only when the ID is in the reserved UUID namespace and the stored resource owner matches. Never print raw driver errors.
- `{"status":"unavailable"}` without a recovery ID: failure occurred before the probe creation service was reached (for example storage initialization).

The first test invocation may initialize **Mastra-owned memory tables** through the standard `memory.init()` method on Turso. This is an expected native storage initialization, not arbitrary SQL or a Supabase migration. Any authorization to execute the Cloud test includes only this narrowly scoped Mastra memory-domain change and a single probe thread.

The routes accept no body, custom SQL, table name or arbitrary storage namespace. Probe IDs use a generated UUIDv4 and must match a strict prefix. The marker is random and is never returned; only its SHA-256 fingerprint is exposed. Driver errors are suppressed. No automatic restart or cleanup is executed by this feature. If the test fails, retain the receipt for controlled operator cleanup and keep the gate open. Do not run repeated writes or treat local SQLite persistence as proof of remote Turso durability.

**Security:** Anyone who has the operator API token can use the probe while it is enabled. Enable only for the short validation window and disable immediately afterward. Do not expose the token, attach the test to a public agent, or treat this diagnostic as a user-facing feature.
