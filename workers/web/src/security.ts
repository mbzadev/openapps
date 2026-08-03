import type { MiddlewareHandler } from 'hono'

const securityHeaders: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

export const secureHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  for (const [name, value] of Object.entries(securityHeaders)) c.header(name, value)
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local'
}
