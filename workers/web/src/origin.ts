type PublicUrlEnv = { APP_URL: string; ENVIRONMENT: string }

export function publicAppUrl(env: PublicUrlEnv, requestUrl: string) {
  if (env.ENVIRONMENT === 'production') return new URL(env.APP_URL).origin
  return new URL(requestUrl).origin
}

export function allowedCorsOrigin(origin: string) {
  if (!origin) return 'https://apps.mbza.dev'
  try {
    const hostname = new URL(origin).hostname
    const allowed = hostname === 'apps.mbza.dev'
      || hostname === 'openapps-web-preview.mbza.workers.dev'
      || /^[a-z0-9-]+-openapps-web-preview\.mbza\.workers\.dev$/i.test(hostname)
    return allowed ? origin : ''
  } catch {
    return ''
  }
}
