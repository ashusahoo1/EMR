/**
 * Process entry point. Listening lives here and nowhere else -- see the note
 * at the top of app.ts for why.
 */
import { app } from './app.ts'
import { log } from './log.ts'

const port = Number(process.env.PORT ?? 3001)

app.listen(port, () => {
  log.info('api listening', {
    port,
    docs: `http://localhost:${port}/docs`,
    llmEnabled: process.env.LLM_ENABLED !== 'false',
  })
})
