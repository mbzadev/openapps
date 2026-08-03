export type Database = D1Database | D1DatabaseSession

export async function first<T>(db: Database, sql: string, ...values: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>()
}

export async function all<T>(db: Database, sql: string, ...values: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>()
  return result.results
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function jsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
