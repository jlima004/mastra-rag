# E1 H6-R2 — Protected `rag_app` credential operation handoff

**Date:** 2026-11-18. **Owner authorization:** explicit `Execute E1_H6_R2_CREDENTIAL_PROVISIONING`. **Provider target:** Supabase `mastra-rag`, ref `lmocjhpajhxegzobydau`, organization `Alquem.io`, plan **Free**, project ACTIVE_HEALTHY, PG17.11. **Reviewed baseline:** `master` `c43786cbb1e8fdb942813696f0ff1155436d903e` (PR #25 merged, post-merge CI and deploy PASS).

**Execution outcome:** `H6_R2_OWNER_AUTHORIZED / HOSTED_METADATA_PREFLIGHT_PASS / LOGGING_SESSION_REHEARSAL_PASS / CREDENTIAL_NOT_SET / AUTH_NOT_TESTED / HUMAN_INTERACTIVE_TERMINAL_REQUIRED`.

This note **does not attest** completed credential provisioning. The Supabase connector can issue SQL, but this ChatGPT session cannot read the operator's protected terminal, open an interactive `psql` prompt on their WSL host, or securely collect a new password. **No secret, SCRAM verifier, connection URI with password, or role-password mutation was sent via connector or GitHub.** Credentials must not be pasted into chat.

## 1. Hosted preflight and current limits

On 2026-11-18, provider-scoped SELECT-only SQL confirmed:
- `rag_app` count 1, minimal flags true (`LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`), membership count 0.
- `USAGE` on `extensions`, no `CREATE` there, no `USAGE/CREATE` on `rag`, no `CREATE` on `public`.
- `rag` still 0 catalog tables; `20261117213614` catalog migration absent. `password_encryption = scram-sha-256`.
- Supabase Security Advisor read returned `lints=[]`.
- Observed session defaults: `log_statement=ddl`, `log_min_error_statement=error`, `log_min_messages=warning`, `pg_stat_statements.track=top`, `pgaudit.log=none`.
- `has_parameter_privilege(name,'SET')` for the five controls reported **false**, but a **real transaction-scoped test** with the same Supabase project-targeted `postgres` session successfully executed `BEGIN; SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_min_messages='fatal'; SET LOCAL pg_stat_statements.track='none'; SET LOCAL pgaudit.log='none'; SELECT current_setting(...); ROLLBACK;`. All five scoped values matched. An independent subsequent SELECT verified **all original defaults restored**. This is a **no-password, no-persistent-config** rehearsal; actual psql sessions still need their own checks.

Official Supabase security note: [Provisioning Postgres role credentials without exposing them in logs](https://supabase.com/kb/troubleshooting/provisioning-credentials-without-log-exposure). A successful standard single-quoted password change is normally masked in the statement log, but failures, dynamic/dollar-quoted SQL and `pg_stat_statements` may expose the password or its SCRAM verifier unless mitigated. **Never set the password with SQL inline or a ChatGPT tool call.**

## 2. Operator-only, terminal-local procedure — NOT EXECUTED

The owner must perform the next step **on their own trusted WSL terminal**, or delegate through an explicitly trusted tool that provides a genuine interactive, non-recorded secret prompt. Neither this PR nor its CI can do it.

Prepare a unique high-entropy password in a trusted password manager (do not display, copy to chat, commit to Git, export to an environment variable, or place in command-line arguments). Use `psql` 17 and the current **Supabase Connect > Session pooler** host. **Never guess the pooler host**; Supabase Free typically uses its shared session pooler for IPv4, port 5432. Download the server root certificate from the project Database Settings; use TLS hostname verification.

Shell command (no password in command line), after **replacing placeholders locally**:

```sh
psql -X -W "host=<HOST_FROM_SUPABASE_CONNECT> port=5432 dbname=postgres user=postgres.lmocjhpajhxegzobydau sslmode=verify-full sslrootcert=<CERT_PATH>"
```

The terminal prompts for the **existing admin database password** locally. Do **not** send it here or into an assistant tool.

Inside the **same interactive psql session**:

```sql
\conninfo
SELECT current_user, session_user, current_database();
SELECT count(*) AS rag_app_count FROM pg_catalog.pg_roles WHERE rolname = 'rag_app';
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL log_min_messages = 'fatal';
SET LOCAL pg_stat_statements.track = 'none';
SET LOCAL pgaudit.log = 'none';
SELECT current_setting('log_statement'),
       current_setting('log_min_error_statement'),
       current_setting('log_min_messages'),
       current_setting('pg_stat_statements.track'),
       current_setting('pgaudit.log');
```

**STOP + `ROLLBACK;`** unless the connected server is the verified project, current/session user is `postgres`, role count is 1, **each** `SET LOCAL` succeeds and the SELECT displays `none, panic, fatal, none, none`. This is not a blanket grant of authority to change database-wide settings. The changes are scoped to the open transaction, and the actual remote `psql` session must be checked even though the tool-based rehearsal passed.

**Only when all above conditions hold**, enter this **psql meta-command interactively in the same transaction**:

```text
\password rag_app
```

Enter the new password twice only at the protected, non-echoing prompts. `psql` computes a verifier client-side. Verify that the command reports **successful ALTER ROLE** before issuing `COMMIT;`. If an error occurs, issue `ROLLBACK;`, stop and investigate **without retrying or revealing the verifier**. Do not run `\password` again just to test. After commit, `SHOW log_statement;` and `SHOW log_min_messages;` should show `ddl` and `warning` as before. Exit `psql` after recording only a generic non-secret success/failure label.

**Important:** Avoid SQL Editor, `psql -c`, shell `echo`, heredocs containing passwords, dollar-quoted password SQL, log exports, `.env` or chat with plaintext or verifier. Do not enter a personal password in a session recorder or streaming/AI terminal.

## 3. Separate authentication proof, no role modifications

After successfully committing and verifying the password manager entry, establish **a fresh independent connection** as the custom role, with an interactive password prompt, `sslmode=verify-full` and the same trusted pooler host:

```sh
psql -X -W "host=<HOST_FROM_SUPABASE_CONNECT> port=5432 dbname=postgres user=rag_app.lmocjhpajhxegzobydau sslmode=verify-full sslrootcert=<CERT_PATH>" -v ON_ERROR_STOP=1 -Atc "SELECT CASE WHEN current_user='rag_app' AND NOT has_schema_privilege(current_user,'rag','USAGE') AND has_schema_privilege(current_user,'extensions','USAGE') AND NOT has_schema_privilege(current_user,'public','CREATE') THEN 'H6_R2_AUTH_PASS' ELSE 'H6_R2_AUTH_FAIL' END"
```

Expected result: **`H6_R2_AUTH_PASS`**. If the session pooler reports authentication failure immediately after rotation, do **not** assume the password was lost: Supabase documents short-lived pooler credential caching. One bounded retry after provider instructions, or a separately configured direct IPv6 probe, may be needed. Avoid repeated guesses/lockouts; do not share error output containing connection URIs.

The operator may share **only** these sanitized facts in the chat: "password set/transaction COMMIT confirmed", "H6_R2_AUTH_PASS", date, and confirmation no secret was logged or copied. No password, verifier, DSN or log dump. Only then can H6-R2 be independently closed and recorded as `VERIFIED`. If either stage fails, keep the gate `BLOCKED` without claiming the role is ready.

## 4. Authority separation

H6-R2 authorization is **already granted** by the owner, so no fresh approval is needed for the exact authorized interactive credential operation. The missing capability is a protected **human-operated** terminal, not another ratification. H6-R2 does **not** approve setting a runtime DSN, pushing H5 catalog migrations, creating vector tables, modifying the Free plan, bypassing H10 cancellation, enabling H7/H11/H12 or running E2.

**H10 remains canceled for Free MVP. `NO_BACKUP_MVP` remains unchanged.** This is an operator handoff with a verified read-only and reversible-log rehearsal; **no hosted credential change has occurred yet**.
