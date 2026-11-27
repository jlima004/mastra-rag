# H11 — Embedding spend controls (operator decision package)

**Prepared 2026-11-19; baseline:** `master@58268ece070293143a76ffdda4edce56160cf33e` (H7 PR #30 merged, CI/deploy verified). H11 was originally prepared as an **offline-only Draft PR** with no permission to call a paid provider. **Later decisions:** the owner ratified the numerical policy and approved paid embeddings **charged directly to their OpenAI API account** on 2026-11-19; on 2026-11-23, the owner supplied UI evidence of a dedicated project, active billing and provider controls (tracked in [Issue #32](https://github.com/jlima004/mastra-rag/issues/32)). Neither decision enables paid execution without the remaining application gates.

## 1. Technical decision — H11-OPS, 2026-11-27

The installed `@mastra/core@1.83.0` embedding router resolves the provider key through its registry and invokes the bundled OpenAI provider with `OPENAI_API_KEY` for the literal `openai/` model ID. Mastra Gateway has a separate explicit branch and key, and the literal model ID does not select it or fall back to another provider when its key is missing. The bundled provider honors `OPENAI_BASE_URL`. An offline fetch interception shows the override receives the same bearer token. Its embedding response parsing reduces rows to vectors without exposing their indices and may fail before reaching usage. Direct `doEmbed` delegates once per invocation in the installed implementation.

H11-OPS uses Node's native fetch at the fixed OpenAI endpoint, with a server-side credential read at execution, a single non-replayable POST body, redirect rejection, timeout and bounded response. The adapter verifies the indexed vector mapping and reports known usage even when it rejects the batch. The E2 ledger classifies overage ahead of vector errors and retains conservative exposure for an unknown outcome. Node 22 and 24 checks cover route construction and the installed tokenizer; loopback tests exercise native HTTP 421 replay and redirect behavior. The Mastra server has no embedding registration, and the Step D byte estimate stays offline.

E2 was merged at `d05e05e2dda1d62adbc27535e7e541a6045ad6a3`; its hosted schema and authenticated readiness were confirmed before H11-OPS. S512 and H12 are ratified. The operator entrypoint reuses the E2 ledger for ingestion. Query and evaluation callers remain future work. The [runbook](../rag/h11-ops-runbook.md) covers key custody, preflight, activation and first use. Offline destination proof does not establish which project a future credential bills.

## 2. Owner-ratified MVP budget — 2026-11-19

**All numerical values below were explicitly ratified by the owner on 2026-11-19**, along with paid-embedding consent for their **directly billed OpenAI API account**. This is a financial decision, **not** executable production configuration or permission to bypass live-call gates. Provider controls listed as verified were confirmed by **owner-supplied UI evidence on 2026-11-23**, not by a live API request. See [H11-OPS Issue #32](https://github.com/jlima004/mastra-rag/issues/32).

| Control | Ratified MVP bound | Semantics |
| --- | --- | --- |
| Billing identity | Dedicated owner-controlled **OpenAI API project `Rag-Mastra`**, direct OpenAI API billing only, `text-embedding-3-small` | Project existence verified by owner UI; **actual Mastra runtime billing route and scoped API key still unproven**. Mastra Gateway charges are not authorized. |
| Provider hard spend limit | **USD 2.00 per calendar month**, **Limit enforced** | Verified by owner UI on 2026-11-23; independent provider safety net with noninstantaneous enforcement, **not** a strict zero-overrun guarantee |
| Application project monthly budget | **USD 1.00** projected *embeddings* only | Conservative app budget below provider cap, does not cover unrelated provider usage |
| Application monthly reservation | **5,000,000 token-envelope units** | Durable E2 counter for ingestion + evaluation |
| Daily reservation | **250,000 token-envelope units** | Durable server-side counter, UTC date boundary |
| Per-job reservation | **150,000 token-envelope units**, including worst-case three global retries | Below immutable `MAX_TOKENS_PER_JOB=2,000,000`; refuse oversized jobs upfront |
| Evaluation reservation | **100,000 token-envelope units/month** | Separate sub-budget, also counts toward global monthly/daily limits |
| Alerts | **50%, 80%, 95%** on the dedicated OpenAI API project | Configured and verified by owner UI on 2026-11-23; notification only, not enforcement |
| Other models | **Blocked** at project allowlist; only `text-embedding-3-small` allowed | Verified by owner UI on 2026-11-23; no other paid model or Google fallback approved |

At the published price 5 million tokens would cost about **USD 0.10** for this embedding model, *if* billed at that price. Dollar budget exceeds estimated embedding cost intentionally to accommodate measurement error and other project spend, but is **not an accurate forecast** until the exact tokenizer, billing route, and all key consumers are reconciled.

The owner's **budget and paid-use consent is recorded**, and the project limit, model allowlist, alerts, and active **Pay as you go** billing with **auto-reload OFF** were evidenced in the owner UI on 2026-11-23. Do not publish balance/payment details or project identifiers. Remaining distinct gates are (a) proving the exact billed runtime route, (b) privately provisioning a project-scoped server-side key with separate release approval, and (c) separately authorizing the **first live paid ingestion**. No such operation is authorized merely by merging this PR.

## 3. Operational release

The OpenAI model and API references checked on 2026-11-27 list USD 0.02 per million input tokens, 8,192 max tokens per input and 300,000 max tokens per request, compatible with S512 and the 128-input limit. Project spend alerts and enforced hard limits are independent. The owner previously evidenced `Limit enforced` for USD 2/month, but propagation can allow additional usage. Reconfirm current settings and credential scope using the runbook. [Model](https://developers.openai.com/api/docs/models/text-embedding-3-small) · [Embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create) · [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits).

E2 reserves before dispatch and retains exposure across restarts, duplicate claims and uncertain outcomes. The first operation selects the frozen Resolução 18 snapshot and uses one call across that job, with zero retries and the existing 20,136-token reservation. Its operational cap leaves the ratified E2 retry policy intact. A durable start can remain ambiguous after a crash and requires operator reconciliation.

Pending: project-scoped key provisioning, administrative hosted activation, specific authorization for the first paid ingestion and subsequent provider-side billing attribution. Paid execution remains blocked.
