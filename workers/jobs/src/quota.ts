export type QuotaState = { tokens: number; updated_at: number } | null

export function nextQuota(state: QuotaState, limit: number, periodSeconds: number, now: number) {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(periodSeconds) || periodSeconds <= 0) throw new Error('Invalid quota configuration')
  const refillPerMs = limit / (periodSeconds * 1000)
  const available = Math.min(limit, state ? state.tokens + Math.max(0, now - state.updated_at) * refillPerMs : limit)
  if (available < 1) return { allowed: false, retryAfterMs: Math.ceil((1 - available) / refillPerMs), tokens: available }
  return { allowed: true, retryAfterMs: 0, tokens: available - 1 }
}
