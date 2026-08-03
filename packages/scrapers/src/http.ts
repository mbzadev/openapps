const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export async function fetchBoundedJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://apps.apple.com/', 'User-Agent': USER_AGENT },
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
