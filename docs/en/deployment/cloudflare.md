# Cloudflare deployment

Cloudflare Builds connects `openapps-web` and `openapps-jobs` to the same GitHub repository. The production branch is `main`; non-production branches receive isolated preview resources.

The web build runs `npm ci`, generated-binding checks, lint, types, Node/workerd tests, static builds, D1 migrations and the `workers/web/wrangler.jsonc` deploy. The jobs build executes the same quality gate before deploying `workers/jobs/wrangler.jsonc`. Only the web pipeline owns migrations.

`apps.mbza.dev` is attached exclusively to `openapps-web`; the jobs Worker remains private.
