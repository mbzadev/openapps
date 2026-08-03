# Contributing to OpenApps by MBZA

Fork [mbzadev/openapps](https://github.com/mbzadev/openapps), branch from `main`, and keep changes Cloudflare-native.

Before submitting a pull request, run:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Do not add server-only runtimes, containers or secrets. Schema changes must be additive D1 migrations first; `openapps-web` remains the sole migration owner. Queue messages are versioned and consumers must remain idempotent.
