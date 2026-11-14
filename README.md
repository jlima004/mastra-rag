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

PR #3: document ingestion, chunking and vector index creation; PR #4: retrieval, RAG agent and evaluation. Keep application secrets out of the repository.
