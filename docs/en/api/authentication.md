# Authentication

Public registration and login are available at `/api/v1/auth/register` and `/api/v1/auth/login`. Passwords use versioned PBKDF2-HMAC-SHA-256 hashes with random salts and 600,000 cumulative iterations. Cloudflare caps a WebCrypto PBKDF2 call at 100,000, so the versioned Cloudflare format performs six sequential 100,000-iteration derivations.

Browser sessions are `HttpOnly`, `Secure` and `SameSite=Lax`. API and OAuth access tokens are opaque; only their SHA-256 fingerprints are stored in D1.

Create integration tokens from account settings. OAuth clients request `openapps:read` and optionally `openapps:write`.
