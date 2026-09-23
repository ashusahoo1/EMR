/**
 * Rate limiting for the AI endpoints (BUILD_ROADMAP B7, EMR_PLAN §4.11).
 *
 * WHAT THIS PROTECTS. Not the server -- the server would happily serve a
 * thousand requests. It protects the OPENAI BILL and the provider quota. A
 * runaway client (or a doctor leaning on a Generate button that has lost its
 * disabled state) turns into real money at a few cents a call, and into a
 * provider-side 429 that affects every other user of the key.
 *
 * WHY IN-PROCESS AND NOT REDIS. The honest answer is scope: this is a single
 * process serving one clinic, so a Map is sufficient and a Redis dependency
 * would be theatre. The cost is stated plainly rather than hidden -- see
 * LIMITATIONS at the bottom. Knowing why the simple thing is adequate here,
 * and exactly when it stops being adequate, is the point.
 *
 * SLIDING WINDOW, NOT FIXED. A fixed window ("20 per minute, counter resets
 * on the minute") allows 40 calls in two seconds spanning the boundary --
 * 20 at :59 and 20 at :01 -- which is precisely the burst we are trying to
 * prevent. Keeping timestamps costs a few bytes per client and removes the
 * failure mode entirely.
 */
import { log } from './log.ts'

/**
 * Requests per window, per client, for the AI endpoints.
 *
 * Set from what a working doctor plausibly does rather than from a round
 * number: a consultation involves one transcribe and one or two Generate
 * presses, so a busy ten minutes might be a dozen calls. Twenty per minute
 * leaves generous headroom for a fast worker and still stops a loop dead.
 */
export const AI_RATE_LIMIT = {
  get max(): number {
    // Overridable so the suite is not throttled by its own volume. The
    // limiter is process-wide by design, and hundreds of in-process test
    // requests share one client key, so a production-sized limit would make
    // unrelated tests fail depending on execution order -- the worst kind of
    // flake. The limiter's actual behaviour is tested directly, with an
    // injected clock, rather than by making twenty HTTP calls.
    const override = Number(process.env.AI_RATE_LIMIT_MAX)
    return Number.isFinite(override) && override > 0 ? override : 20
  },
  windowMs: 60_000,
}

/**
 * Per-client request timestamps.
 *
 * Module-level rather than per-instance: Elysia constructs the plugin once,
 * and a limiter whose state resets when a route is re-registered is not a
 * limiter.
 */
const hits = new Map<string, number[]>()

/**
 * Entries are pruned lazily on access, so a client that never returns would
 * otherwise sit in the Map forever. This sweep bounds that.
 */
const SWEEP_INTERVAL_MS = 5 * 60_000
let lastSweep = Date.now()

export interface RateLimitResult {
  allowed: boolean
  /** Requests still available in the current window. */
  remaining: number
  /** Seconds until the oldest request ages out. For Retry-After. */
  retryAfterSeconds: number
}

/**
 * Record a request and say whether it is allowed.
 *
 * Exported and pure-ish (the Map is the only state) so B7's tests can drive
 * it directly with a fake clock rather than making twenty HTTP calls.
 */
export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  limit: { max: number; windowMs: number } = AI_RATE_LIMIT,
): RateLimitResult {
  sweep(now, limit.windowMs)

  const cutoff = now - limit.windowMs
  const recent = (hits.get(key) ?? []).filter((at) => at > cutoff)

  if (recent.length >= limit.max) {
    // Do NOT record this attempt. Counting rejected requests would extend
    // the lockout every time an over-eager client retried, turning a
    // one-minute limit into an indefinite one.
    const oldest = recent[0] ?? now
    hits.set(key, recent)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)),
    }
  }

  recent.push(now)
  hits.set(key, recent)

  return {
    allowed: true,
    remaining: limit.max - recent.length,
    retryAfterSeconds: 0,
  }
}

/** Drop clients whose whole history has aged out. */
function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now

  const cutoff = now - windowMs
  for (const [key, timestamps] of hits) {
    if (timestamps.every((at) => at <= cutoff)) hits.delete(key)
  }
}

/** Forget all state. Tests only -- the limiter is process-wide. */
export function resetRateLimits(): void {
  hits.clear()
  lastSweep = Date.now()
}

/**
 * Identify the caller.
 *
 * There is no authentication yet (F21), so this is the request IP, read from
 * the proxy headers a deployment would set. Stated as a limitation rather
 * than dressed up: without auth, clients behind one NAT share a bucket, and
 * a determined caller can spoof `x-forwarded-for`. With F21 this becomes the
 * doctor id and both problems disappear.
 */
export function clientKey(request: Request, fallback = 'unknown'): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // The left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || fallback
}

/**
 * Log a rejection.
 *
 * Separate from the check so the pure function stays testable without
 * assertions on log output.
 */
export function logRateLimited(key: string, path: string): void {
  log.warn('rate limited', { client: key, path, max: AI_RATE_LIMIT.max })
}

/**
 * LIMITATIONS -- for the README, stated as tradeoffs rather than omissions.
 *
 * 1. IN-PROCESS. State lives in this process's memory, so it resets on
 *    restart and is not shared across instances. Two replicas behind a load
 *    balancer each allow the full limit. Fix: Redis, or a limiter at the
 *    ingress. Not needed at one process serving one clinic.
 *
 * 2. IP-BASED. Without auth (F21) the key is an IP, so a shared NAT shares a
 *    bucket and `x-forwarded-for` is spoofable by anyone who can reach the
 *    server directly. Fix: key on the authenticated doctor id.
 *
 * 3. NOT A COST CAP. It bounds request COUNT, not spend. A single request
 *    with a huge note costs more than ten small ones, which is why the token
 *    cap in llm/ exists separately and is the real money guardrail.
 */
