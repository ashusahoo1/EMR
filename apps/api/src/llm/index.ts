/**
 * Which LLM client the process uses (B0).
 *
 * The selection rules, in order -- and the ORDER MATTERS:
 *
 *   1. LLM_ENABLED=false       -> no client at all, in every environment
 *                                 including tests. Callers surface
 *                                 AI_UNAVAILABLE (E23).
 *   2. NODE_ENV=test           -> the stub. A test must never spend money or
 *                                 depend on a network, and `bun test` has to
 *                                 pass with no API key set (Sector B exit
 *                                 criterion).
 *   3. OPENAI_API_KEY missing  -> no client. Treated as "the provider is
 *                                 down" rather than a crash, so a missing key
 *                                 degrades gracefully instead of taking the
 *                                 API with it (E20).
 *   4. otherwise               -> the real OpenAI client.
 *
 * Checking the test environment FIRST would be the obvious ordering and it
 * is wrong: it makes LLM_ENABLED=false unreachable under test, so the E23
 * degradation path -- the guardrail §4.11 calls the most important one --
 * could never be exercised by the suite. Five tests caught exactly that.
 *
 * Resolved per call rather than captured at import, so a test can flip
 * LLM_ENABLED between cases without module-cache games.
 */
import { LIMITS } from '@emr/shared'
import { log } from '../log.ts'
import { OpenAiClient } from './openai.ts'
import { stubLlm } from './stub.ts'
import type { LlmClient } from './types.ts'

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test'
}

/** Whether AI assistance is switched on. An unset value means enabled. */
export function isLlmEnabled(): boolean {
  return process.env.LLM_ENABLED !== 'false'
}

/** Memoised real client, so we do not rebuild the SDK on every request. */
let realClient: OpenAiClient | undefined
let realClientKey: string | undefined

/**
 * The client for this call, or `null` when AI is unavailable.
 *
 * Returning null rather than throwing keeps the decision with the caller:
 * the service layer knows which error code and message the doctor should
 * see, and this module does not need to know about HTTP.
 */
export function getLlmClient(): LlmClient | null {
  // Rule 1 before rule 2: the kill switch works in tests too, or E23 is
  // untestable. See the ordering note above.
  if (!isLlmEnabled()) return null
  if (isTestEnv()) return stubLlm

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    log.warn('OPENAI_API_KEY is not set; AI features are unavailable')
    return null
  }

  const visionModel = process.env.VISION_MODEL
  const textModel = process.env.TEXT_MODEL
  if (!visionModel || !textModel) {
    log.warn('VISION_MODEL or TEXT_MODEL is not set; AI features are unavailable', {
      visionModel: Boolean(visionModel),
      textModel: Boolean(textModel),
    })
    return null
  }

  // Rebuild only if the key changed (it will not, in practice).
  if (!realClient || realClientKey !== apiKey) {
    realClient = new OpenAiClient({
      apiKey,
      visionModel,
      textModel,
      timeoutMs: LIMITS.llmTimeoutMs,
    })
    realClientKey = apiKey
    log.info('openai client initialised', { visionModel, textModel })
  }

  return realClient
}

/** True when a real, non-stub client would be returned. */
export function hasRealLlm(): boolean {
  return !isTestEnv() && getLlmClient() !== null
}

export { stubLlm } from './stub.ts'
export * from './types.ts'
