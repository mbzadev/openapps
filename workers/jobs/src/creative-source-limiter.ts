import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env.js'
import { nextQuota } from './quota.js'

export class CreativeSourceLimiter extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS source_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tokens REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      circuit_open_until INTEGER
    )`)
  }

  async acquire(limit = 5, periodSeconds = 60): Promise<{ allowed: boolean; retryAfterMs: number; circuitOpen: boolean }> {
    const now = Date.now()
    const row = this.ctx.storage.sql.exec<{ tokens: number; updated_at: number; failure_count: number; circuit_open_until: number | null }>(
      'SELECT tokens,updated_at,failure_count,circuit_open_until FROM source_state WHERE id=1',
    ).toArray()[0]
    if (row?.circuit_open_until && row.circuit_open_until > now) {
      return { allowed: false, retryAfterMs: row.circuit_open_until - now, circuitOpen: true }
    }
    const quota = nextQuota(row ?? null, limit, periodSeconds, now)
    this.ctx.storage.sql.exec(`INSERT INTO source_state (id,tokens,updated_at,failure_count,circuit_open_until)
      VALUES (1,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET tokens=excluded.tokens,updated_at=excluded.updated_at,
      circuit_open_until=CASE WHEN source_state.circuit_open_until<=? THEN NULL ELSE source_state.circuit_open_until END`,
    quota.tokens, now, row?.failure_count ?? 0, now)
    return { allowed: quota.allowed, retryAfterMs: quota.retryAfterMs, circuitOpen: false }
  }

  async success(): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE source_state SET failure_count=0,circuit_open_until=NULL WHERE id=1')
  }

  async failure(): Promise<{ failures: number; circuitOpenUntil: number | null }> {
    const now = Date.now()
    const row = this.ctx.storage.sql.exec<{ failure_count: number }>('SELECT failure_count FROM source_state WHERE id=1').toArray()[0]
    const failures = (row?.failure_count ?? 0) + 1
    const circuitOpenUntil = failures >= 5 ? now + 24 * 60 * 60 * 1000 : null
    this.ctx.storage.sql.exec(`INSERT INTO source_state (id,tokens,updated_at,failure_count,circuit_open_until)
      VALUES (1,0,?,?,?) ON CONFLICT(id) DO UPDATE SET failure_count=excluded.failure_count,
      circuit_open_until=excluded.circuit_open_until`, now, failures, circuitOpenUntil)
    return { failures, circuitOpenUntil }
  }
}
