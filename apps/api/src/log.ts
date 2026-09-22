/**
 * Structured logging.
 *
 * JSON lines, because B7 requires a machine-readable record of every AI call
 * (latency, tokens, verification outcome) and grepping prose is worse than
 * grepping JSON.
 *
 * Nothing here ever reaches a client response.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

/**
 * Tests deliberately provoke 500s to prove nothing leaks, so their stack
 * traces would drown the real signal in CI. `LOG_LEVEL=silent` suppresses
 * output without changing any behaviour under test.
 */
const configured = (process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === 'test' ? 'silent' : 'info')) as Level | 'silent'
const threshold =
  configured === 'silent' ? Number.POSITIVE_INFINITY : (LEVELS[configured] ?? LEVELS.info)

type Fields = Record<string, unknown>

function emit(level: Level, message: string, fields?: Fields): void {
  if (LEVELS[level] < threshold) return
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...fields,
  })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (message: string, fields?: Fields) => emit('debug', message, fields),
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
}

/** Flatten an unknown thrown value into loggable fields. Never returned to a client. */
export function describeError(error: unknown): Fields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack }
  }
  return { errorValue: String(error) }
}
