# Environment variables

Cloudflare bindings are declared in the two `wrangler.jsonc` files. Production secrets are configured outside Git.

The stdio MCP client supports:

- `OPENAPPS_API_URL` — defaults to `https://apps.mbza.dev/api/v1`.
- `OPENAPPS_API_TOKEN` — an OpenApps bearer token.

The legacy `APPSTORECAT_*` names are compatibility fallbacks.

Creative collection is staged with `CREATIVES_ENABLED=false` in both Workers. Enable it only after configuring these `openapps-jobs` secrets outside Git:

- `META_AD_LIBRARY_ACCESS_TOKEN` — approved Meta Ad Library API token.
- `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` — TikTok Commercial Content API application credentials with `research.adlib.basic`.

`META_GRAPH_API_VERSION` selects the Meta Graph API version. Creative media is stored in the private `openapps-creatives` R2 bucket and served only through authenticated Worker routes.
