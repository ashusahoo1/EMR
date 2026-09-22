/**
 * The single database connection for the process.
 *
 * `max: 5` because Neon's free tier pools connections on their side and a
 * container host will run more than one instance. Elysia is long-lived, so
 * the pool is created once at import and reused.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to apps/api/.env and add your Neon connection string.',
  )
}

export const sql = postgres(url, { max: 5 })
export const db = drizzle(sql, { schema })

export type Db = typeof db
export { schema }
