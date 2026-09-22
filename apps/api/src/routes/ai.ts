/**
 * AI routes (A8, stubbed -- real pipeline lands at B6).
 *
 * The contract here is final. Only the service bodies change when Sector B
 * arrives, so Sector C can be built against these today.
 */
import { Elysia } from 'elysia'
import { structureConsultation, transcribeImage } from '../services/ai.ts'
import {
  IdParam,
  StructureResponse,
  TranscribeBody,
  TranscribeResponse,
} from './schemas.ts'

export const aiRoutes = new Elysia()
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
  .post('/transcribe', async ({ body }) => await transcribeImage(body.image), {
    body: TranscribeBody,
    response: TranscribeResponse,
    detail: {
      summary: 'Transcribe handwritten notes from an image',
      tags: ['ai'],
    },
  })
