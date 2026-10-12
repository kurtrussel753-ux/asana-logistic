# Asana agent runtime (sidecar)

Mastra agents & workflows + Vercel AI SDK models + official MCP SDK, governed by the IFA server.
Every tool call goes back to the server (`/api/runtime/call` → `agCall`), so whitelists, roles, budgets, autonomy levels,
approvals, four-eyes and audit stay where they were. Full guide (Persian): [`../docs/runtime-migration.md`](../docs/runtime-migration.md).

```bash
npm ci
IFA_SERVER_URL=http://127.0.0.1:8080 IFA_RUNTIME_TOKEN=<same as server> npm start   # :8090
npm test        # e2e with the real server, fake model (native tool calls), fake Langfuse/SMTP — no network
```

| module | role |
|---|---|
| `src/models.js` | AI SDK provider factory (OpenAI-compatible/LiteLLM, Anthropic, Ollama) + governance middleware (PII mask/unmask, budget, usage/cost, tracing) |
| `src/agents.js` | Mastra agent per server agent (pilot: analyst), grounding check + one repair round |
| `src/workflows/hitl.js` | `procurement-rfq`, `finance-payment` — durable suspend on approval, resume on decision |
| `src/workflows/flows.js` | server flow definitions → Mastra workflows (same template/condition language) |
| `src/mcp.js` | Streamable-HTTP MCP endpoint (`ifa_mcp_` keys) |
| `src/tracing.js` | Langfuse ingestion (masked prompts) |
| `src/legacy.gen.js` | generated from `server.js` by `scripts/sync-runtime.js` — do not edit |
