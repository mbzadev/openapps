import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env.js'
import { nextQuota } from './quota.js'

export class StoreRateLimiter extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS quota (
      id INTEGER PRIMARY KEY CHECK (id = 1), tokens REAL NOT NULL, updated_at INTEGER NOT NULL
    )`)
  }

  async acquire(limit: number, periodSeconds: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const now = Date.now()
    const row = this.ctx.storage.sql.exec<{ tokens: number; updated_at: number }>('SELECT tokens, updated_at FROM quota WHERE id = 1').toArray()[0] ?? null
    const result = nextQuota(row ?? null, limit, periodSeconds, now)
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO quota (id,tokens,updated_at) VALUES (1,?,?)', result.tokens, now)
    return { allowed: result.allowed, retryAfterMs: result.retryAfterMs }
  }
}
