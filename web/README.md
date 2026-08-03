# OpenApps web

React SPA for OpenApps by MBZA. Production assets are built with Vite and served by `openapps-web` through Workers Static Assets.

```bash
npm run typecheck -w frontend
npm run build -w frontend
```

Browser authentication uses the secure session cookie issued by `/api/v1/auth/login`; access tokens are never persisted in browser storage.
