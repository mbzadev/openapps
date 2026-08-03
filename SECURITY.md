# Security policy

Report vulnerabilities privately to the repository owner through GitHub Security Advisories. Do not open a public issue before a fix is available.

The supported surface is `apps.mbza.dev`, `workers/web`, `workers/jobs`, shared TypeScript packages and the stdio MCP client. Secrets must stay in Cloudflare secret storage. Browser auth uses secure HttpOnly cookies; API and MCP integrations use opaque Bearer tokens.
