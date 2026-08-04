# API endpoints

The versioned API is rooted at `https://apps.mbza.dev/api/v1`. It preserves the account, folder, app, competitor, change, chart, explorer, country, category and publisher routes from the original public contract.

Browser requests authenticate with a secure `HttpOnly` session cookie. Integrations may use `Authorization: Bearer <token>`. Validation errors use HTTP 422, unauthenticated requests 401 and throttled requests 429.

The public health check is `GET /api/v1/health`.

## Public ad creatives

- `GET /creatives` searches Meta, Google and TikTok creatives by text, source, app, advertiser, publisher, country, format, status and date.
- `GET /creatives/{id}` returns one creative with provenance, variants, regions and archived media.
- `GET /apps/{platform}/{externalId}/creatives` lists creatives linked to an app.
- `POST /apps/{platform}/{externalId}/creatives/sync` queues an asynchronous publisher refresh.
- `GET /ad-advertisers/{id}/creatives` lists an advertiser's creatives.

Archived media is streamed from `GET /creative-assets/{sha256}`. The route supports byte ranges for video playback; the R2 bucket is not public. Spend, reach and impression ranges are returned only when the public source supplies them and are explicitly marked as non-exact.
