# MCP server

The recommended endpoint is `https://apps.mbza.dev/mcp`. It uses stateless Streamable HTTP and OAuth 2.1 authorization code flow with S256 PKCE. Discovery metadata is published under `/.well-known/`.

The remote and stdio variants expose exactly 29 tools: 25 read tools and four write tools. Write calls require `openapps:write`.

For the compatible stdio client:

```bash
OPENAPPS_API_URL=https://apps.mbza.dev/api/v1 \
OPENAPPS_API_TOKEN=<token> \
npm start -w @openapps/mcp
```

Legacy `APPSTORECAT_API_URL` and `APPSTORECAT_API_TOKEN` variables remain accepted as fallback only.
