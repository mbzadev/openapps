# OpenApps

OpenApps is a Cloudflare-native App Store and Google Play intelligence platform available at [apps.mbza.dev](https://apps.mbza.dev).

Create an account in the browser. No server, database or container needs to be installed: the React application, API and MCP endpoint run on Cloudflare Workers; D1, KV, R2, Queues and Durable Objects provide the data plane.

For local development:

```bash
npm ci
npm run cf:migrate:local
npm run build:web-assets
npm run dev -w @openapps/web-worker
```

Production is deployed from the `main` branch through Cloudflare Builds.
