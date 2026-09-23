/**
 * The Elysia application.
 *
 * This module BUILDS and EXPORTS the app. It does not listen -- `index.ts`
 * does that. The split is not stylistic: Eden Treaty's in-process test mode
 * (§2.5) imports this object and calls `app.handle` directly, with no network
 * and no port. If this file listened on import, every integration test in A9
 * would fight over a port and the suite would flake.
 */
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { Elysia } from 'elysia'
import { handleError } from './error-handler.ts'
import { aiRoutes } from './routes/ai.ts'
import { readRoutes } from './routes/read.ts'
import { writeRoutes } from './routes/write.ts'

/**
 * Which browser origins may call this API.
 *
 * `WEB_ORIGIN` is the production answer and is honoured exactly: a deployed
 * API must not accept requests from arbitrary origins, and a wildcard here
 * would be a genuine security hole rather than a convenience.
 *
 * IN DEVELOPMENT, ANY LOCALHOST PORT IS ALLOWED. Next picks a different port
 * whenever 3000 is taken -- on this machine another application holds it, so
 * the dev server lands on 3005 and every request fails preflight with "No
 * Access-Control-Allow-Origin header". That is a confusing failure, because
 * the API is plainly running and answering /health: the browser reports it
 * as a network error and the obvious conclusion is that the backend is down.
 *
 * Pinning WEB_ORIGIN to whatever port Next chose today would work until the
 * next time it chose differently. Accepting any localhost origin in
 * development removes a class of wasted debugging, and it cannot loosen
 * production because NODE_ENV is not 'development' there.
 */
function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  // Same-origin requests, curl and server-to-server calls send no Origin.
  if (!origin) return true

  const configured = process.env.WEB_ORIGIN ?? 'http://localhost:3000'
  if (origin === configured) return true

  if (process.env.NODE_ENV === 'production') return false

  // Any port on the loopback host, http only.
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
}

export const app = new Elysia()
  .use(
    cors({
      origin: isAllowedOrigin,
      credentials: true,
    }),
  )
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'EMR Consultation Workspace API',
          version: '0.1.0',
          description:
            'Standalone Elysia service. All business logic lives here, not in Next.js route handlers.',
        },
      },
    }),
  )
  /** One envelope for every failure -- see error-handler.ts. */
  .onError(handleError)
  .get('/health', () => ({ ok: true as const }))
  .use(readRoutes)
  .use(writeRoutes)
  .use(aiRoutes)

export type App = typeof app
