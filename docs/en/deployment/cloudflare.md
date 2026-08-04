# Cloudflare deployment

Cloudflare Builds connects `openapps-web` and `openapps-jobs` to the same GitHub repository. The production branch is `main`. Preview deployments and preview resources are disabled.

The web build runs `npm ci`, generated-binding checks, lint, types, Node/workerd tests, the OpenNext build, Payload migrations and the `platform/wrangler.jsonc` deploy. The jobs build executes the same quality gate before deploying `workers/jobs/wrangler.jsonc`. Only the web pipeline owns migrations.

`apps.mbza.dev` is attached exclusively to `openapps-web`; the jobs Worker remains private and has `workers_dev` disabled. GitHub Actions is not used.
