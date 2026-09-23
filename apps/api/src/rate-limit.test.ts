/**
 * Rate limiting (BUILD_ROADMAP B7, EMR_PLAN §4.11).
 *
 * Driven with an INJECTED CLOCK rather than by making twenty HTTP calls and
 * sleeping. A limiter tested with real time is either slow or flaky, and
 * usually both -- the window boundary cases are exactly the ones a
 * wall-clock test cannot hit reliably.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { checkRateLimit, clientKey, resetRateLimits } from './rate-limit.ts'

/** A small limit, so the tests read as arithmetic rather than as loops. */
const LIMIT = { max: 3, windowMs: 60_000 }

/** A fixed origin for the fake clock; any epoch works. */
const T0 = 1_700_000_000_000

beforeEach(() => {
  resetRateLimits()
})

describe('requests within the limit are allowed', () => {
  test('the first request passes', () => {
    const result = checkRateLimit('a', T0, LIMIT)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  test('remaining counts down to zero', () => {
    expect(checkRateLimit('a', T0, LIMIT).remaining).toBe(2)
    expect(checkRateLimit('a', T0 + 1, LIMIT).remaining).toBe(1)
    expect(checkRateLimit('a', T0 + 2, LIMIT).remaining).toBe(0)
  })

  test('the request at exactly the limit still passes', () => {
    // Off-by-one guard: "max: 3" means three requests succeed, not two.
    checkRateLimit('a', T0, LIMIT)
    checkRateLimit('a', T0 + 1, LIMIT)
    expect(checkRateLimit('a', T0 + 2, LIMIT).allowed).toBe(true)
  })
})

describe('requests over the limit are rejected', () => {
  test('the fourth request in the window is blocked', () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0 + i, LIMIT)

    const result = checkRateLimit('a', T0 + 3, LIMIT)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  test('it reports how long to wait', () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0, LIMIT)

    // The oldest request was at T0, so the window frees up 60s later.
    const result = checkRateLimit('a', T0 + 30_000, LIMIT)
    expect(result.retryAfterSeconds).toBe(30)
  })

  test('retryAfterSeconds is never zero on a rejection', () => {
    // A "wait 0 seconds" message invites an immediate retry that will also
    // fail. Rounds up to at least one.
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0, LIMIT)
    const result = checkRateLimit('a', T0 + 59_999, LIMIT)
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })
})

describe('THE SLIDING WINDOW -- why not a fixed one', () => {
  test('a fixed-window burst across the boundary is NOT possible', () => {
    // The failure a fixed window has: 3 calls at the end of one minute and 3
    // at the start of the next is 6 calls in a moment. A sliding window sees
    // them as 6 within 60s and rejects.
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0 + 59_000 + i, LIMIT)

    // One second later -- a new minute for a fixed window, same window here.
    expect(checkRateLimit('a', T0 + 60_000, LIMIT).allowed).toBe(false)
  })

  test('capacity returns gradually as individual requests age out', () => {
    // Not all at once on a reset tick: each request frees its own slot
    // exactly windowMs after it was made.
    checkRateLimit('a', T0, LIMIT)
    checkRateLimit('a', T0 + 10_000, LIMIT)
    checkRateLimit('a', T0 + 20_000, LIMIT)
    expect(checkRateLimit('a', T0 + 30_000, LIMIT).allowed).toBe(false)

    // The first request ages out just after T0 + 60s, freeing one slot.
    expect(checkRateLimit('a', T0 + 60_001, LIMIT).allowed).toBe(true)
    // But the second has not, so the next is still blocked.
    expect(checkRateLimit('a', T0 + 60_002, LIMIT).allowed).toBe(false)
  })

  test('a fully elapsed window resets the budget', () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0, LIMIT)
    expect(checkRateLimit('a', T0 + 60_001, LIMIT).allowed).toBe(true)
  })
})

describe('a rejected request does not extend the lockout', () => {
  test('hammering while blocked does not push the window forward', () => {
    // If rejected attempts were recorded, an over-eager client retrying
    // every second would never be let back in -- a one-minute limit becomes
    // indefinite. This is the bug that makes naive limiters infuriating.
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0, LIMIT)

    for (let t = 1_000; t < 60_000; t += 1_000) {
      expect(checkRateLimit('a', T0 + t, LIMIT).allowed).toBe(false)
    }

    // Still freed on schedule, despite 59 rejected attempts.
    expect(checkRateLimit('a', T0 + 60_001, LIMIT).allowed).toBe(true)
  })
})

describe('clients are counted separately', () => {
  test("one client's budget does not affect another's", () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit('a', T0, LIMIT)
    expect(checkRateLimit('a', T0, LIMIT).allowed).toBe(false)
    expect(checkRateLimit('b', T0, LIMIT).allowed).toBe(true)
  })
})

describe('identifying the caller', () => {
  test('x-forwarded-for takes the left-most entry', () => {
    // The original client; everything after it is a proxy.
    const request = new Request('http://localhost/transcribe', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' },
    })
    expect(clientKey(request)).toBe('203.0.113.7')
  })

  test('x-real-ip is used when there is no forwarded header', () => {
    const request = new Request('http://localhost/transcribe', {
      headers: { 'x-real-ip': '198.51.100.4' },
    })
    expect(clientKey(request)).toBe('198.51.100.4')
  })

  test('a request with no proxy headers falls back rather than throwing', () => {
    // In-process calls (Eden, tests) have no IP at all.
    expect(clientKey(new Request('http://localhost/transcribe'))).toBe('unknown')
  })

  test('an empty forwarded header does not become an empty key', () => {
    // An empty key would put every such caller in one bucket, which is the
    // fallback behaviour anyway -- but via a string that reads like a bug.
    const request = new Request('http://localhost/transcribe', {
      headers: { 'x-forwarded-for': '' },
    })
    expect(clientKey(request)).toBe('unknown')
  })
})
