# OpenApps

Cloudflare-native App Store and Google Play intelligence, deployed at [apps.mbza.dev](https://apps.mbza.dev).

OpenApps runs Payload CMS 3 and Next.js on Cloudflare Workers through OpenNext. The public product, the Payload operations back office, the compatible `/api/v1` API and the 29-tool OAuth MCP endpoint are delivered by `openapps-web`. The private `openapps-jobs` Worker runs store synchronization, charts, creative collection, reconciliation and cleanup through Cron Triggers and Queues.

## Architecture

- `platform/` — Payload CMS 3, Next.js, the `/admin` operations back office and the OpenNext Cloudflare deployment.
- `web/` — the existing React 19 product UI, embedded as versioned static assets by `platform`.
- `workers/web/` — the compatible Hono API, cookie/Bearer authentication, OAuth 2.1 and stateless Streamable HTTP MCP, embedded by `platform`.
- `workers/jobs/` — Cron, Queue consumers, R2 DLQ archiving and rate-limiter Durable Objects.
- `packages/connectors/` — reusable connector plugin contract and registry.
- `packages/core/` — shared domain, crypto, D1 helpers, messages and structured logs.
- `packages/db/` — Drizzle schema for all 17 D1 tables and the typed D1 client.
- `packages/scrapers/` — modular native Fetch Apple and Google Play connectors.
- `migrations/` — compatible SQLite/D1 domain migrations and reference seeds.
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

Create `platform/.env.local` from `platform/.env.example`, set a long random `PAYLOAD_SECRET`, then run `npm run dev -w @openapps/platform`. The product remains at `/login`; the operator back office is at `/admin`. On the first start, Payload presents its secure first-staff-user form.

Cloudflare bindings live in `platform/wrangler.jsonc` and `workers/jobs/wrangler.jsonc`. Generate their types with `npm run cf:types`. The production D1 is `openapps-payload-production`; Payload owns its baseline migration and the additive domain migration chain remains under `migrations/` for Worker tests and compatibility.

The operations dashboard never fabricates metrics. It reads D1 directly and exposes queue state, connector health, collection runs, creative coverage and dead letters. Operators can dispatch due creative targets and replay compatible DLQ entries; both actions are authenticated and written to the Payload audit log.
`npm run check` verifies committed Wrangler-generated binding types, lint, TypeScript, Node Vitest and workerd integration tests. The exact 437 pre-rewrite scenarios are retained in `tests/legacy-scenarios.json` as the behavioral migration catalog.

## MCP

Remote endpoint: `https://apps.mbza.dev/mcp`. It uses OAuth 2.1 authorization code flow, S256 PKCE and the `openapps:read` / `openapps:write` scopes.

The stdio compatibility client accepts `OPENAPPS_API_URL` and `OPENAPPS_API_TOKEN`, falling back to the legacy `APPSTORECAT_*` variable names.

## Delivery

The production branch is `main`. Cloudflare Builds connects both Workers to this monorepo; GitHub Actions is intentionally not used, so validation does not consume Actions minutes. `master` is retained as the pre-rewrite backup branch.

Configure the two Cloudflare Builds projects without preview deployments:

- `openapps-web`: root directory `/`, build command `npm ci && npm run check`, deploy command `npm run deploy -w @openapps/platform`.
- `openapps-jobs`: root directory `/`, build command `npm ci && npm run check`, deploy command `npm run deploy -w @openapps/jobs-worker`.

Set `PAYLOAD_SECRET` as an encrypted `openapps-web` Worker secret, and keep Meta/TikTok credentials as encrypted `openapps-jobs` secrets. Never put those values in Git or Cloudflare Build variables printed in logs. Production is promoted only from validated `main` commits. Preview Workers and preview resources are intentionally absent.

MIT — see [LICENSE](LICENSE).
