/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { StoreRateLimiter } from '../../workers/jobs/src/rate-limiter.js'

describe('StoreRateLimiter Durable Object', () => {
  it('serializes quota decisions and persists the bucket over a cold start', async () => {
    const stub = env.STORE_RATE_LIMITER.get(env.STORE_RATE_LIMITER.idFromName('ios:test'))

    await expect(stub.acquire(2, 60)).resolves.toMatchObject({ allowed: true })
    await expect(stub.acquire(2, 60)).resolves.toMatchObject({ allowed: true })
    await expect(stub.acquire(2, 60)).resolves.toMatchObject({ allowed: false })

    const rows = await runInDurableObject(stub, async (_instance: StoreRateLimiter, state) =>
      state.storage.sql.exec<{ tokens: number }>('SELECT tokens FROM quota WHERE id=1').toArray())
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tokens).toBeLessThan(1)

    await evictDurableObject(stub)
    await expect(stub.acquire(2, 60)).resolves.toMatchObject({ allowed: false })
  })
})
