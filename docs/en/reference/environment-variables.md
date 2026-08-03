# Environment variables

Cloudflare bindings are declared in the two `wrangler.jsonc` files. Production secrets are configured outside Git.

The stdio MCP client supports:

- `OPENAPPS_API_URL` — defaults to `https://apps.mbza.dev/api/v1`.
- `OPENAPPS_API_TOKEN` — an OpenApps bearer token.

The legacy `APPSTORECAT_*` names are compatibility fallbacks.
