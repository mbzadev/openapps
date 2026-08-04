# OpenApps MCP (stdio compatibility)

The recommended MCP integration is the OAuth endpoint at `https://apps.mbza.dev/mcp`. This directory keeps a compatible local stdio bridge exposing the same 29 tools.

```bash
OPENAPPS_API_URL=https://apps.mbza.dev/api/v1 \
OPENAPPS_API_TOKEN=<token> \
npm start -w @openapps/mcp
```

`APPSTORECAT_API_URL` and `APPSTORECAT_API_TOKEN` remain supported as legacy fallbacks. The four write tools require a token with write access.
