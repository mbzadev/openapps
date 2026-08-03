import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema.js'

export * from './schema.js'

export function createDatabase(database: Parameters<typeof drizzle>[0]) {
  return drizzle(database, { schema })
}

export type DrizzleDatabase = ReturnType<typeof createDatabase>
