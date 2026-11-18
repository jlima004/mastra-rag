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
\i db/readonly/e1_h6_rag_app_postflight.sql
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

**Role-contract gate (mandatory BEFORE `BEGIN` and BEFORE entering a password):** the `\\i` above invokes **the already-reviewed** `db/readonly/e1_h6_rag_app_postflight.sql` from merged PR #24. Run the terminal from the correct, trusted repository root and ensure that file matches the merged baseline; do not `\\i` an unverified local edit. Stop immediately if the file cannot be read or any one of these **fresh** values differs:

| Postflight field | Required |
| --- | --- |
| `role_count` | `1` |
| `flags_minimal` | `true` (LOGIN, NOINHERIT; not superuser, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS) |
| `membership_count`, `owns_schema`, `owns_rag_relations` | all `0` |
| `extensions_usage` | `true` |
| `extensions_create`, `rag_usage_before_catalog`, `rag_create`, `public_create` | all `false` |
| `catalog_table_count` | `0` |

These checks are **required even if an earlier read-only tool preflight passed**, because privileged role flags, memberships and grants could drift in between. A `role_count=1` check alone is **not sufficient**. The later `H6_R2_AUTH_PASS` probe is **an authentication proof**, not a substitute for the full privileged-role guard.

**Transaction/log gate:** if the connected server is not the provider-verified project, current/session user is not `postgres`, any role-contract field differs, **any** `SET LOCAL` fails, or the logging SELECT does not display `none, panic, fatal, none, none`, **STOP**. If a transaction has begun, issue `ROLLBACK;` and do not enter a password. This is not a blanket grant of authority to change database-wide settings. The changes are scoped to the open transaction, and the actual remote `psql` session must be checked even though the tool-based rehearsal passed.

**Only when all above conditions hold**, enter this **psql meta-command interactively in the same transaction**:

```text
\password rag_app
```

Enter the new password twice only at the protected, non-echoing prompts. `psql` computes a verifier client-side. **PostgreSQL 17's interactive `\\password` returns to the prompt silently on success; it does NOT print an `ALTER ROLE` success tag.** Do not wait for such a message. After the password was entered and confirmed in both prompts, with no cancellation or error reported, run a non-secret check **in the same open transaction**:

```sql
SELECT 'H6_R2_TRANSACTION_HEALTHY' AS status;
```

Require the exact `H6_R2_TRANSACTION_HEALTHY` row and no `current transaction is aborted` error. This proves the transaction is still usable, **not** by itself that the password change occurred. **If either password prompt was canceled, any `\\password` error occurred, or the check fails: `ROLLBACK;` and STOP**, without retrying or revealing the verifier. Only after a clean two-prompt change and healthy transaction may the operator enter:

```sql
COMMIT;
SHOW log_statement;
SHOW log_min_messages;
```

Require a successful `COMMIT` completion and restoration of `ddl` and `warning`. A committed change must still pass the **fresh password-authenticated H6_R2_AUTH_PASS** test in section 3; transaction health alone is not a credential proof. Do not run `\\password` again just to test. Exit `psql` after recording only a generic non-secret success/failure label.

**Important:** Avoid SQL Editor, `psql -c`, shell `echo`, heredocs containing passwords, dollar-quoted password SQL, log exports, `.env` or chat with plaintext or verifier. Do not enter a personal password in a session recorder or streaming/AI terminal.

## 3. Separate authentication proof, no role modifications

After successfully committing and verifying the password manager entry, establish **a fresh independent connection** as the custom role, with an interactive password prompt, `sslmode=verify-full` and the same trusted pooler host:

```sh
psql -X -W "host=<HOST_FROM_SUPABASE_CONNECT> port=5432 dbname=postgres user=rag_app.lmocjhpajhxegzobydau sslmode=verify-full sslrootcert=<CERT_PATH>" -v ON_ERROR_STOP=1 -Atc "SELECT CASE WHEN current_user='rag_app' AND NOT has_schema_privilege(current_user,'rag','USAGE') AND has_schema_privilege(current_user,'extensions','USAGE') AND NOT has_schema_privilege(current_user,'public','CREATE') THEN 'H6_R2_AUTH_PASS' ELSE 'H6_R2_AUTH_FAIL' END"
```

Expected result: **`H6_R2_AUTH_PASS`**. This role-scoped authentication probe verifies only login and its listed effective schema privileges. **It does not revalidate memberships, ownership, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS**; that full privileged-role check is the **mandatory fresh `db/readonly/e1_h6_rag_app_postflight.sql` gate above**. If needed, rerun that same read-only postflight after successful authentication from the separately authenticated administrator connection before closing H6-R2. If the session pooler reports authentication failure immediately after rotation, do **not** assume the password was lost: Supabase documents short-lived pooler credential caching. One bounded retry after provider instructions, or a separately configured direct IPv6 probe, may be needed. Avoid repeated guesses/lockouts; do not share error output containing connection URIs.

The operator may share **only** these sanitized facts in the chat: "password set/transaction COMMIT confirmed", "H6_R2_AUTH_PASS", date, and confirmation no secret was logged or copied. No password, verifier, DSN or log dump. Only then can H6-R2 be independently closed and recorded as `VERIFIED`. If either stage fails, keep the gate `BLOCKED` without claiming the role is ready.

## 4. Authority separation

H6-R2 authorization is **already granted** by the owner, so no fresh approval is needed for the exact authorized interactive credential operation. The missing capability is a protected **human-operated** terminal, not another ratification. H6-R2 does **not** approve setting a runtime DSN, pushing H5 catalog migrations, creating vector tables, modifying the Free plan, bypassing H10 cancellation, enabling H7/H11/H12 or running E2.

**H10 remains canceled for Free MVP. `NO_BACKUP_MVP` remains unchanged.** This is an operator handoff with a verified read-only and reversible-log rehearsal; **no hosted credential change has occurred yet**.
