# OpenApps by MBZA

Cloudflare-native App Store and Google Play intelligence, deployed at [apps.mbza.dev](https://apps.mbza.dev).

OpenApps serves a React SPA, the compatible `/api/v1` API, documentation and a 29-tool OAuth MCP endpoint from `openapps-web`. A private `openapps-jobs` Worker runs store synchronization, charts, reconciliation and cleanup through Cron Triggers and Queues.

## Architecture

- `web/` — React 19 SPA served through Workers Static Assets.
- `workers/web/` — Hono API, cookie/Bearer authentication, OAuth 2.1 and stateless Streamable HTTP MCP.
- `workers/jobs/` — Cron, Queue consumers, R2 DLQ archiving and the `StoreRateLimiter` Durable Object.
- `packages/core/` — shared domain, crypto, D1 helpers, messages and structured logs.
- `packages/db/` — Drizzle schema for all 17 D1 tables and the typed D1 client.
- `packages/scrapers/` — native Fetch Apple and Google Play collectors.
- `migrations/` — SQLite/D1 schema and reference seeds.
- `docs-site/` — Astro/Starlight documentation published below `/docs`.
- `mcp/` — backward-compatible local stdio client.

There is no PHP, Python, MySQL, Redis or container runtime.

## Development

```bash
npm ci
npm run cf:migrate:local
npm run check
npm run build
```

Use `npm run dev -w @openapps/web-worker` for local Worker development. Cloudflare bindings and Cron schedules live in the two `wrangler.jsonc` files.
`npm run check` verifies committed Wrangler-generated binding types, lint, TypeScript, Node Vitest and workerd integration tests. The exact 437 pre-rewrite scenarios are retained in `tests/legacy-scenarios.json` as the behavioral migration catalog.

## MCP

Remote endpoint: `https://apps.mbza.dev/mcp`. It uses OAuth 2.1 authorization code flow, S256 PKCE and the `openapps:read` / `openapps:write` scopes.

The stdio compatibility client accepts `OPENAPPS_API_URL` and `OPENAPPS_API_TOKEN`, falling back to the legacy `APPSTORECAT_*` variable names.

## Delivery

The production branch is `main`. Cloudflare Builds connects both Workers to this monorepo; a failed lockfile install, typecheck, test or build prevents deployment. `master` is retained as the pre-rewrite backup branch.

Production is promoted only from validated `main` commits; non-production branches target the isolated preview bindings.

MIT — see [LICENSE](LICENSE).
