# API endpoints

The versioned API is rooted at `https://apps.mbza.dev/api/v1`. It preserves the account, folder, app, competitor, change, chart, explorer, country, category and publisher routes from the original public contract.

Browser requests authenticate with a secure `HttpOnly` session cookie. Integrations may use `Authorization: Bearer <token>`. Validation errors use HTTP 422, unauthenticated requests 401 and throttled requests 429.

The public health check is `GET /api/v1/health`.
