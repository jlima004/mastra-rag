# mastra-rag

Minimal [Mastra](https://mastra.ai) TypeScript project prepared for a document-based RAG application backed by Supabase PostgreSQL and pgvector.

## Current scope

This repository intentionally contains **no registered agents, tools, workflows, or processors**. The original general-purpose starter agent and its filesystem, shell, web, scheduler, memory, and local database integrations have been removed.

The Supabase connection, document ingestion, vector indexes, semantic retrieval, and RAG agent **are not implemented yet**. They will be added in separate pull requests.

## Run locally

Requirements: Node.js >= 22.13 and npm.

```bash
npm ci
npm run typecheck
npm run build
npm run dev
```

Open [Mastra Studio](http://localhost:4111) after starting the dev server. No agents will appear until a RAG agent is implemented.

## Deployment

The existing [Mastra Platform](https://projects.mastra.ai) project linkage remains in `.mastra-project.json`. Removing the starter agent means its former agent endpoints will no longer exist **after a deployment of these changes**. A GitHub pull request alone does not verify or deploy the cloud runtime.

## Next milestone: Supabase RAG foundation

Add `@mastra/pg`, configure a server-only PostgreSQL connection, introduce a controlled document ingestion pipeline, and validate pgvector indexing and semantic retrieval. Keep database credentials out of Git and client bundles.

Consult [Mastra documentation](https://mastra.ai/docs) and [Supabase AI & Vector documentation](https://supabase.com/docs/guides/ai) before implementation.
