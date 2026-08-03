import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env.js'

export class StoreRateLimiter extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS quota (
      id INTEGER PRIMARY KEY CHECK (id = 1), tokens REAL NOT NULL, updated_at INTEGER NOT NULL
    )`)
  }

  async acquire(limit: number, periodSeconds: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const now = Date.now()
    const refillPerMs = limit / (periodSeconds * 1000)
    const row = this.ctx.storage.sql.exec<{ tokens: number; updated_at: number }>('SELECT tokens, updated_at FROM quota WHERE id = 1').one()
    const available = Math.min(limit, row ? row.tokens + (now - row.updated_at) * refillPerMs : limit)
    if (available < 1) {
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO quota (id,tokens,updated_at) VALUES (1,?,?)', available, now)
      return { allowed: false, retryAfterMs: Math.ceil((1 - available) / refillPerMs) }
    }
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO quota (id,tokens,updated_at) VALUES (1,?,?)', available - 1, now)
    return { allowed: true, retryAfterMs: 0 }
  }
}
