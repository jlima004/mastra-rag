# E1 — Runtime DSN integration (read-only, owner secret handoff)

**2026-11-18 — Code gate: prepared; actual runtime credential activation: NOT VERIFIED.**

Owner explicitly authorized **E1_RUNTIME_DSN_INTEGRATION**. Baseline `master` `5ddc0cee8167b55da025f51aec7d75ab446e0f04` (PR #28 merged/deployed). This PR changes only a *lazy read-only* authenticated probe and configuration validation: **no production DSN or credentials were retrieved or altered**, no database writes and no E2 authorization. Existing Mastra /health remains independent and is not proof of Supabase connectivity.

## Fixed security contract

- **Identity:** actual PostgreSQL session principal must be `current_user=session_user=rag_app`. The DSN is restricted to `rag_app.lmocjhpajhxegzobydau` at the previously verified regional *session pooler* `aws-0-sa-east-1.pooler.supabase.com:5432/postgres`; **no `postgres`, `service_role`, direct host, other project, or transaction pooler fallback**.
- **TLS:** exactly one `sslmode=verify-full` query parameter; no connection string overrides. Mastra Platform hosted environment requires `SUPABASE_CA_CERT_BASE64` from the verified public Supabase project CA certificate. Existing TLS helper uses a per-pool `ssl` object with `rejectUnauthorized:true` and `servername` anchored to the validated host. **Never set `rejectUnauthorized:false`, `sslmode=require`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or bypass CA checks**.
- **Runtime:** `createSupabaseVectorStore` remains *lazy*, `disableInit:true`, small pool (max 2), no `new Mastra({ vectors })` registration, and no public vector routes. The existing **authenticated** `GET /internal/readiness/supabase` and `npm run db:check` now perform an actual SQL **SELECT-only** contract probe. No application start-up dependence on the DSN has been introduced.
- **Probe:** validates runtime identity, private `rag` and `extensions.vector`, minimal `rag_app` privileges and active RLS, owned `chunks_te3s_1536_v1` with 1536-dimensional vector and unique namespace/vector-id index, three namespace=`public` policies, row access boundaries, sequence USAGE, operator-controlled `embedding_space` model, and `anon`/`authenticated`/`service_role` exclusion. The registry may remain `building`; a positive probe **never means ingestion has been enabled**.
- **Namespace:** `@mastra/pg@1.35.0` defaults to `default`, while RLS allows only `public`. The constant `RAG_VECTOR_NAMESPACE='public'` is exposed for a *future* explicitly authorized E2 client; **no vector query/upsert/delete is called here**.
- **Diagnostics:** authenticated route returns only `{status:'ok'}` or `{status:'unavailable',category:'...'}`; all source errors/URLs/credentials remain suppressed. The CLI prints only a sanitized error category.
- **Storage:** Turso is still the Mastra runtime state store; there is no use of PostgreSQL owner credentials for runtime storage.

## Owner-only secret configuration (after PR code-review/merge)

The user already proved an independent TLS `verify-full` login as `rag_app` using `psql -W`, but that **was not** an application-runtime or Mastra Platform credential test.

1. In the trusted **Mastra Platform project production environment**, configure **server-only secrets** `POSTGRES_CONNECTION_STRING` and `SUPABASE_CA_CERT_BASE64`. A service-managed Railway runtime deployment is not evidence that direct Railway environment-edit access is granted; prefer the actual project's platform secret settings. **Do not send either value in chat, PR, GitHub Actions, code, build args, screenshots or logs.** Neither value has been installed by this PR.
2. DSN format (placeholders only):

   ```text
   postgresql://rag_app.lmocjhpajhxegzobydau:<URL_ENCODED_RAG_APP_PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full
   ```

   Use the existing *`rag_app`* password from its private secret store, not the administrator's password. Percent-encode the password using a trusted local password-manager/encoder before pasting **only into platform server-side secrets**. Never paste it into the chat or terminal output. No new password rotation is needed.
3. Retrieve the **public** project CA already validated in WSL at `/home/jlima/.config/supabase_cert/mastra_rag/prod-ca-2021.crt`. Convert its PEM contents to **base64** in a private session (e.g. `base64 -w 0 /home/jlima/.config/supabase_cert/mastra_rag/prod-ca-2021.crt`) and copy it directly to `SUPABASE_CA_CERT_BASE64`; do **not** publish even this operational configuration value. Avoid introducing a new CA or disabling hostname verification.
4. Release the separately reviewed code and let the platform apply the server-side env change using its normal controlled deployment flow. **Do not set `DATABASE_URL` or reuse the admin `SUPABASE_DB_PASSWORD`** as runtime credentials.

## Operator acceptance — no write operations

- From a private trusted workstation with the same server-only env configuration, run `npm run db:check`. The command now refuses privileged DSNs and performs the same SELECT-only runtime gate. Output only `E1 runtime read-only check passed: rag_app identity, vector catalog and RLS ready.` or a sanitized error category. Ensure `.env` is ignored/private (`0600`) and do not include raw env values in CI logs.
- After controlled deploy, use the existing authenticated, internal `GET /internal/readiness/supabase` with an operator token **privately**. The expected result is HTTP 200 with only `{"status":"ok"}`. Never paste request headers or token. HTTP 503 with a fixed category is a **STOP**; do not use a privileged DSN or disable TLS to force a green check.
- Independently verify through the Supabase project-scoped metadata postflight that registry remains `building`, vector row count remains zero, H5 migration ledger untouched, RLS/grants unchanged and Security Advisor clean. A successful generic `/health` or a CI pass **does not** prove the live runtime DSN works.

## Scope and outstanding gates

**Code readiness != production secret activation.** This PR may pass local tests and CI without any Supabase secrets. Runtime DSN is **not `COMPLETE / VERIFIED`** until the owner provides sanitized real `rag_app`-authenticated probe evidence. No generic Mastra /health can satisfy the runtime gate.

- No `createIndex`, schema/grant changes, migration history modifications, seeded vectors, embedding requests, model expense, E2 ingest, delete/GC, or retention policy change.
- H7 operator access, H11 provider budget and H12 retention/GC remain separate decisions.
- H10 remains canceled for Free MVP; `NO_BACKUP_MVP` remains accepted.
- **No automatic merge/deploy** of this Draft PR. Exact-head CI + independent Codex review + separate human approval required.

**State:** `E1_RUNTIME_CODE_CANDIDATE / SECRET_OPERATOR_HANDOFF_PENDING / LIVE_RAG_APP_AUTH_UNVERIFIED / E2_BLOCKED`.
