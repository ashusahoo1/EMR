/**
 * AI routes (A8, stubbed -- real pipeline lands at B6).
 *
 * The contract here is final. Only the service bodies change when Sector B
 * arrives, so Sector C can be built against these today.
 */
import { Elysia } from 'elysia'
import { AppError, ErrorCode } from '../errors.ts'
import { checkRateLimit, clientKey, logRateLimited } from '../rate-limit.ts'
import { structureConsultation, transcribeImage } from '../services/ai.ts'
import {
  IdParam,
  StructureResponse,
  TranscribeBody,
  TranscribeResponse,
} from './schemas.ts'

export const aiRoutes = new Elysia()
  /**
   * E21 -- rate limit the AI endpoints (§4.11).
   *
   * Applied to this group only. The read and write routes are cheap database
   * queries; throttling them would degrade the app without protecting
   * anything. These two endpoints are the ones that cost money.
   *
   * `onBeforeHandle` rather than per-route, so a future AI endpoint is
   * covered by construction rather than by remembering.
   */
  .onBeforeHandle(({ request, path }) => {
    const key = clientKey(request)
    const result = checkRateLimit(key)

    if (!result.allowed) {
      logRateLimited(key, path)
      // The same code the provider's own 429 maps to, because from the
      // doctor's side it is the same situation with the same remedy: wait a
      // moment, then try again.
      throw new AppError(ErrorCode.RATE_LIMITED, {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      })
    }
  })
  /**
   * F5 -- structure the consultation's stored notes.
   *
   * No body: the notes already live on the consultation, and taking them
   * from the request instead would let the client structure text the server
   * never saved, which breaks the audit chain (§4.8).
   */
  .post(
    '/consultations/:id/structure',
    async ({ params }) => await structureConsultation(params.id),
    {
      params: IdParam,
      response: StructureResponse,
      detail: {
        summary: 'Structure rough notes into the fixed schema',
        tags: ['ai'],
      },
    },
  )

  /**
   * F8 -- transcribe a photograph of handwritten notes.
   *
   * Returns text only. It deliberately does NOT chain into structuring:
   * stage 2's human checkpoint is the entire product thesis (§4.4), so the
   * doctor reads the transcript and presses Generate themselves.
   *
   * The image is never persisted (§2.3) -- processed in memory, only the
   * transcript is stored.
   */
  .post(
    '/transcribe',
    async ({ body }) =>
      await transcribeImage({
        type: body.image.type,
        size: body.image.size,
        // Read into memory and never written to disk (§2.3): persisting the
        // image would mean object storage, a lifecycle policy and a much
        // larger data-protection footprint. Only the transcript is stored.
        bytes: new Uint8Array(await body.image.arrayBuffer()),
      }),
    {
      body: TranscribeBody,
      response: TranscribeResponse,
      detail: {
        summary: 'Transcribe handwritten notes from an image',
        tags: ['ai'],
      },
    },
  )
