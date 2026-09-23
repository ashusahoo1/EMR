/**
 * Test preload: make apps/api/.env visible regardless of where `bun test`
 * was invoked from.
 *
 * Bun auto-loads .env from the current working directory only. The test
 * suite runs from the repo root, so without this the API's DATABASE_URL is
 * missing and every database-touching test fails -- identically in CI (D3).
 *
 * Values already present in the environment win, so CI can inject its own
 * DATABASE_URL without this file overriding it.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Tests provoke 500s on purpose to prove nothing leaks; their stack traces
// would bury real failures. log.ts reads this to stay quiet.
process.env.NODE_ENV ??= 'test'

/**
 * Raise the AI rate limit for the suite.
 *
 * The limiter is process-wide by design (see rate-limit.ts), and every
 * in-process test request shares one client key, so hundreds of them would
 * exhaust a production-sized budget and fail unrelated tests according to
 * execution order. The limiter stays ENABLED -- its middleware still runs on
 * every AI request -- and its actual behaviour is tested directly with an
 * injected clock in rate-limit.test.ts.
 */
process.env.AI_RATE_LIMIT_MAX ??= '100000'

const envPath = join(import.meta.dir, '..', 'apps', 'api', '.env')

if (existsSync(envPath)) {
  const file = Bun.file(envPath)
  const text = await file.text()

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()

    // LOG_LEVEL is a developer convenience for the running server. Copying it
    // into tests would un-silence the deliberate 500s above.
    if (key === 'LOG_LEVEL') continue

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
