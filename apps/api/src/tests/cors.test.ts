/**
 * CORS origin policy (fixed after a dev-time failure).
 *
 * THE BUG. WEB_ORIGIN was pinned to http://localhost:3000, but Next picks a
 * different port whenever 3000 is taken -- on the development machine
 * another application holds it, so the dev server landed on 3005 and every
 * request failed preflight with "No Access-Control-Allow-Origin header".
 *
 * That is a confusing failure to debug, because the API is plainly running
 * and answering /health. The browser reports it as a network error, so the
 * obvious conclusion is that the backend is down -- which it is not.
 *
 * THE RISK IN THE FIX is loosening production, so that is what these tests
 * are mostly about: any localhost port is accepted in development, and
 * nothing but the configured origin is accepted in production.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { app } from '../app.ts'

const ORIGINAL_ENV = process.env.NODE_ENV
const ORIGINAL_WEB_ORIGIN = process.env.WEB_ORIGIN

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV
  if (ORIGINAL_WEB_ORIGIN === undefined) {
    delete process.env.WEB_ORIGIN
  } else {
    process.env.WEB_ORIGIN = ORIGINAL_WEB_ORIGIN
  }
})

/** The Access-Control-Allow-Origin header for a preflight from `origin`. */
async function preflight(origin: string): Promise<string | null> {
  const response = await app.handle(
    new Request('http://localhost:4000/appointments', {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'GET',
      },
    }),
  )
  return response.headers.get('access-control-allow-origin')
}

describe('development: any localhost port is allowed', () => {
  test('the port Next actually chose when 3000 was taken', async () => {
    // The exact failing case. 3005 is not configured anywhere; it is
    // whatever was free.
    expect(await preflight('http://localhost:3005')).toBe('http://localhost:3005')
  })

  test('the conventional port still works', async () => {
    expect(await preflight('http://localhost:3000')).toBe('http://localhost:3000')
  })

  test('loopback by IP works too', async () => {
    expect(await preflight('http://127.0.0.1:3005')).toBe('http://127.0.0.1:3005')
  })
})

describe('a permissive dev rule must not permit these, in any mode', () => {
  test('an unrelated origin is refused', async () => {
    expect(await preflight('https://evil.example.com')).toBeNull()
  })

  test('a LOOKALIKE host is refused', async () => {
    // "localhost.evil.com" starts with localhost and is a completely
    // different host. The pattern is anchored at both ends precisely so a
    // substring match cannot let this through.
    expect(await preflight('http://localhost.evil.com')).toBeNull()
  })

  test('a localhost SUBDOMAIN is refused', async () => {
    expect(await preflight('http://sub.localhost:3000')).toBeNull()
  })

  test('https on localhost is refused', async () => {
    // The dev server is http. Accepting https as well would widen the rule
    // for no reason.
    expect(await preflight('https://localhost:3005')).toBeNull()
  })
})

describe('production honours WEB_ORIGIN exactly', () => {
  test('the configured origin is allowed', async () => {
    process.env.NODE_ENV = 'production'
    process.env.WEB_ORIGIN = 'https://emr.example.com'

    expect(await preflight('https://emr.example.com')).toBe('https://emr.example.com')
  })

  test('LOCALHOST IS REFUSED -- the dev convenience does not leak', async () => {
    // The whole risk of this fix in one assertion. A deployed API that
    // accepted any localhost origin would let a page on a developer's
    // machine read production data.
    process.env.NODE_ENV = 'production'
    process.env.WEB_ORIGIN = 'https://emr.example.com'

    expect(await preflight('http://localhost:3005')).toBeNull()
    expect(await preflight('http://127.0.0.1:3000')).toBeNull()
  })

  test('another https origin is refused', async () => {
    process.env.NODE_ENV = 'production'
    process.env.WEB_ORIGIN = 'https://emr.example.com'

    expect(await preflight('https://other.example.com')).toBeNull()
  })
})
