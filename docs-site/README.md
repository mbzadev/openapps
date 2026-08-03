# OpenApps documentation

Astro and Starlight documentation for OpenApps by MBZA. The root build synchronizes Markdown from `docs/en`, builds this site with base `/docs`, and merges it into the Worker static asset output.

```bash
npm run sync-docs -w @openapps/docs-site
npm run build -w @openapps/docs-site
```
