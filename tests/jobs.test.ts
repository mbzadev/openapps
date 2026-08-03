import { describe, expect, it } from 'vitest'
import { nextQuota } from '../workers/jobs/src/quota.ts'

describe('StoreRateLimiter token bucket', () => {
  it('starts full and consumes one token', () => expect(nextQuota(null, 10, 60, 1_000)).toEqual({ allowed: true, retryAfterMs: 0, tokens: 9 }))
  it('refuses an empty bucket with a deterministic retry delay', () => expect(nextQuota({ tokens: 0, updated_at: 1_000 }, 10, 60, 1_000)).toEqual({ allowed: false, retryAfterMs: 6_000, tokens: 0 }))
  it('refills proportionally over time', () => expect(nextQuota({ tokens: 0, updated_at: 1_000 }, 10, 60, 7_000)).toEqual({ allowed: true, retryAfterMs: 0, tokens: 0 }))
  it('caps refill at the configured quota', () => expect(nextQuota({ tokens: 2, updated_at: 0 }, 10, 60, 600_000).tokens).toBe(9))
  it('does not grant tokens when the clock moves backwards', () => expect(nextQuota({ tokens: 0, updated_at: 2_000 }, 10, 60, 1_000).allowed).toBe(false))
  it.each([[0, 60], [-1, 60], [10, 0], [10, -1]])('rejects invalid quota %s/%s', (limit, period) => expect(() => nextQuota(null, limit, period, 0)).toThrow('Invalid quota configuration'))
})
