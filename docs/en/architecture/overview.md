# Architecture

`openapps-web` serves the SPA, `/docs`, `/api/v1`, OAuth metadata and the stateless Streamable HTTP MCP endpoint at `/mcp`. `openapps-jobs` has no public route and processes scheduled and on-demand work.

D1 stores application and account data through the shared Drizzle schema. API reads use D1 Sessions bookmarks for replica-aware sequential consistency. KV stores OAuth clients and short-lived authorization codes. R2 archives failed queue payloads. Seven Queues isolate iOS, Android, charts and reconciliation workloads; stable task IDs make at-least-once deliveries idempotent. `StoreRateLimiter` is a SQLite-backed Durable Object partitioned by store and task kind.

Both Workers are TypeScript and use native Fetch. There is no PHP, Python, MySQL, Redis or container runtime.
