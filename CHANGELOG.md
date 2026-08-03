# Changelog

## 2.0.0 — Cloudflare-native rewrite

- Replaced the legacy backend and scraper services with TypeScript Workers.
- Added D1, KV, R2, Queues, Cron Triggers and a SQLite-backed Durable Object rate limiter.
- Added secure cookie sessions, opaque tokens and OAuth 2.1 for the remote MCP server.
- Preserved `/api/v1` and the 29-tool stdio MCP contract.
- Rebranded the product as OpenApps by MBZA and moved production to `apps.mbza.dev`.
