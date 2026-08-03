const USER_AGENT = 'Mozilla/5.0 (compatible; OpenApps/2.0; +https://apps.mbza.dev)'

export async function fetchBoundedJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Upstream ${response.status} for ${new URL(url).hostname}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 5_000_000) throw new Error('Upstream JSON exceeds the 5 MB safety limit')
  return response.json<T>()
}

export async function fetchBoundedText(url: string, timeoutMs = 20_000): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Upstream ${response.status} for ${new URL(url).hostname}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > 8_000_000) throw new Error('Upstream HTML exceeds the 8 MB safety limit')
  const text = await response.text()
  if (text.length > 8_000_000) throw new Error('Upstream HTML exceeds the 8 MB safety limit')
  return text
}
