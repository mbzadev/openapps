# Architecture

`openapps-web` serves the SPA, `/docs`, `/api/v1`, OAuth metadata and the stateless Streamable HTTP MCP endpoint at `/mcp`. `openapps-jobs` has no public route and processes scheduled and on-demand work.

D1 stores application and account data. KV stores OAuth clients and short-lived authorization codes. R2 archives failed queue payloads. Seven Queues isolate iOS, Android, charts and reconciliation workloads. `StoreRateLimiter` is a SQLite-backed Durable Object partitioned by store and task kind.

Both Workers are TypeScript and use native Fetch. There is no PHP, Python, MySQL, Redis or container runtime.
