# Cloudflare deployment

Cloudflare Builds connects `openapps-web` and `openapps-jobs` to the same GitHub repository. The production branch is `main`; non-production branches receive isolated preview resources.

The web build runs `npm ci`, checks, builds static assets, applies D1 migrations and deploys `workers/web/wrangler.jsonc`. The jobs build checks and deploys `workers/jobs/wrangler.jsonc`. Only the web pipeline owns migrations.

`apps.mbza.dev` is attached exclusively to `openapps-web`; the jobs Worker remains private.
