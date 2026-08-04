type PublicUrlEnv = { APP_URL: string; ENVIRONMENT: string }

export function publicAppUrl(env: PublicUrlEnv, requestUrl: string) {
  void requestUrl
  return new URL(env.APP_URL).origin
}

export function allowedCorsOrigin(origin: string) {
  if (!origin) return 'https://apps.mbza.dev'
  try {
    const hostname = new URL(origin).hostname
    const allowed = hostname === 'apps.mbza.dev'
    return allowed ? origin : ''
  } catch {
    return ''
  }
}
