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
import { readRoutes } from './routes/read.ts'
import { writeRoutes } from './routes/write.ts'

export const app = new Elysia()
  .use(
    cors({
      origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
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

export type App = typeof app
