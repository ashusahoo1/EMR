/**
 * The transcription prompt (BUILD_ROADMAP B2).
 *
 * A prompt's real behaviour needs a real model, which is B8's golden-set
 * eval and costs money. What CAN be tested deterministically is that every
 * rule §4.3 requires is actually present in the text we send, and that the
 * parsing around it behaves.
 *
 * That matters more than it sounds: the failure mode for a prompt is a rule
 * quietly getting dropped in an edit, and nothing else in the system would
 * notice until a drug name came back invented.
 */
import { describe, expect, test } from 'bun:test'
import { ILLEGIBLE_MARKER, PROMPT_VERSION } from '@emr/shared'
import {
  countIllegible,
  isRefusal,
  NOT_NOTES_TOKEN,
  TRANSCRIBE_SYSTEM_PROMPT,
  TRANSCRIBE_TEMPERATURE,
} from './transcribe.ts'

const prompt = TRANSCRIBE_SYSTEM_PROMPT.toLowerCase()

describe('every rule from §4.3 is in the prompt', () => {
  test('transcribe verbatim', () => {
    expect(prompt).toContain('verbatim')
  })

  test('do not correct spelling or grammar', () => {
    expect(prompt).toContain('do not correct spelling')
  })

  test('do not expand abbreviations, with PCM named explicitly', () => {
    // §4.10 uses PCM as the worked example, and it is the one the N02
    // golden-set note tests.
    expect(prompt).toContain('do not expand abbreviations')
    expect(TRANSCRIBE_SYSTEM_PROMPT).toContain('"PCM"')
    expect(TRANSCRIBE_SYSTEM_PROMPT).toContain('"x3d"')
    expect(TRANSCRIBE_SYSTEM_PROMPT).toContain('"C/O"')
  })

  test('do not infer what was probably meant', () => {
    expect(prompt).toContain('do not infer')
  })

  test('THE CRITICAL ONE: mark unreadable text as [illegible]', () => {
    // §4.3 calls this the single most important rule. A fabrication here is
    // invisible to every downstream check, because by stage 4 the
    // fabrication IS the source text.
    expect(TRANSCRIBE_SYSTEM_PROMPT).toContain(ILLEGIBLE_MARKER)
    expect(prompt).toContain('never guess')
  })

  test('the [illegible] rule carries a worked example of the wrong answer', () => {
    // "took amoxicillin yesterday" guessed from a scrawl is the example
    // EMR_PLAN uses. Showing the WRONG output is what makes the rule land.
    expect(prompt).toContain('amoxicillin')
    expect(prompt).toContain('wrong')
  })

  test('preserve line breaks and layout', () => {
    expect(prompt).toContain('preserve layout')
    expect(prompt).toContain('line breaks')
  })

  test('skip printed letterhead, transcribe the handwritten body (E35)', () => {
    expect(prompt).toContain('letterhead')
    expect(prompt).toContain('handwritten body')
  })

  test('refuse non-clinical images (E34)', () => {
    expect(TRANSCRIBE_SYSTEM_PROMPT).toContain(NOT_NOTES_TOKEN)
  })

  test('no preamble, no markdown, no commentary', () => {
    expect(prompt).toContain('do not add a preamble')
    expect(prompt).toContain('code fences')
  })
})

describe('the prompt does not invite interpretation', () => {
  test('it never asks for a summary, diagnosis or structure', () => {
    // A transcription prompt that mentions "summarise" or "diagnosis" is an
    // assistant prompt wearing a disguise (§4.3).
    for (const word of ['summarise', 'summarize', 'diagnosis', 'json', 'structure the']) {
      expect(prompt).not.toContain(word)
    }
  })

  test('temperature is 0 -- transcription has one correct answer', () => {
    expect(TRANSCRIBE_TEMPERATURE).toBe(0)
  })
})

describe('refusal detection (E34, E18)', () => {
  test('the exact sentinel is a refusal', () => {
    expect(isRefusal(NOT_NOTES_TOKEN)).toBe(true)
  })

  test('surrounding whitespace or quotes do not defeat it', () => {
    expect(isRefusal(`  ${NOT_NOTES_TOKEN}\n`)).toBe(true)
    expect(isRefusal(`"${NOT_NOTES_TOKEN}"`)).toBe(true)
  })

  test('a real transcript that mentions the token is NOT a refusal', () => {
    // Only an exact match counts. A note containing the words must still be
    // transcribed, not discarded.
    expect(isRefusal(`C/O fever\n${NOT_NOTES_TOKEN} was written on the page`)).toBe(false)
  })

  test('an ordinary transcript is not a refusal', () => {
    expect(isRefusal('C/O fever x3d, mild cough')).toBe(false)
    expect(isRefusal('')).toBe(false)
  })
})

describe('illegible marker counting', () => {
  test('counts each marker', () => {
    expect(countIllegible('took [illegible] yesterday')).toBe(1)
    expect(countIllegible('[illegible] and [illegible]')).toBe(2)
    expect(countIllegible('nothing unreadable here')).toBe(0)
  })

  test('the marker matches the shared constant the frontend highlights', () => {
    // C5 highlights these so the doctor's eye goes straight to them (§4.4).
    // If the prompt and the constant drift, the highlight silently stops.
    expect(countIllegible(`took ${ILLEGIBLE_MARKER} yesterday`)).toBe(1)
  })
})

describe('prompt versioning (§4.8)', () => {
  test('the version is set and written to the audit trail', () => {
    expect(PROMPT_VERSION.transcription).toBe('transcribe-v1')
  })

  test('it differs from the structuring version', () => {
    // Two stages, two prompts, two versions -- otherwise the audit trail
    // cannot say which wording produced which output.
    expect(PROMPT_VERSION.transcription).not.toBe(PROMPT_VERSION.structuring)
  })
})
