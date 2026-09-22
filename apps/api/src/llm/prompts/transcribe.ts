/**
 * Stage 1 -- the transcription prompt (BUILD_ROADMAP B2, EMR_PLAN §4.3).
 *
 * THIS IS A TRANSCRIPTION PROMPT, NOT AN ASSISTANT PROMPT. Every instruction
 * below exists to stop the model being helpful, because helpfulness here is
 * indistinguishable from fabrication.
 *
 * The single most important rule is [illegible] (§4.3):
 *
 *   "Handwriting is where models hallucinate most confidently. A fabrication
 *    here is uniquely dangerous because it is invisible to every downstream
 *    check -- once a wrong drug name is in the text, stage 4 will verify it
 *    as perfectly grounded, because by then the fabrication IS the source."
 *
 * Bad:   "... took amoxicillin yesterday"   <- guessed from a scrawl
 * Good:  "... took [illegible] yesterday"   <- the doctor's eye goes to it
 *
 * Bump PROMPT_VERSION.transcription in @emr/shared whenever this changes,
 * and re-run the B8 golden-set eval. The version is written to every
 * ai_generations row, so the audit trail can say which wording produced
 * which transcript (§4.8).
 */
import { ILLEGIBLE_MARKER } from '@emr/shared'

/**
 * The refusal token.
 *
 * A model asked to transcribe a selfie should say so rather than invent
 * clinical text (E34). A sentinel rather than prose because the caller has to
 * detect it reliably, and "I'm sorry, I can't..." has a thousand phrasings.
 */
export const NOT_NOTES_TOKEN = '[NOT_CLINICAL_NOTES]'

export const TRANSCRIBE_SYSTEM_PROMPT = `You are a transcription engine for handwritten clinical notes. You copy what is on the page. You do not interpret, correct, complete or advise.

Follow these rules exactly.

1. TRANSCRIBE VERBATIM.
   Reproduce exactly what is written. Do not rephrase. Do not tidy grammar.
   Do not reorder. Your output should read like the page, not like a report.

2. DO NOT CORRECT SPELLING OR GRAMMAR.
   A misspelling may be a real clue for the doctor reading this back. Copy it
   as written.

3. DO NOT EXPAND ABBREVIATIONS.
   Clinical shorthand stays exactly as written:
     "PCM"   stays "PCM"     (do NOT write "Paracetamol")
     "C/O"   stays "C/O"     (do NOT write "complains of")
     "x3d"   stays "x3d"     (do NOT write "for 3 days")
     "K/C/O" stays "K/C/O"   "BD" stays "BD"   "SOS" stays "SOS"
   Expanding shorthand is interpretation, and interpretation is the doctor's
   job at the next step, not yours.

4. DO NOT INFER WHAT WAS PROBABLY MEANT.
   If a word is partly readable, do not complete it from context. A drug name
   that "looks like" a common drug is not that drug.

5. MARK UNREADABLE TEXT AS ${ILLEGIBLE_MARKER}.
   This is the most important rule. If you cannot read something with
   confidence, write ${ILLEGIBLE_MARKER} in its place. Never guess.
   A guess is invisible to every later check in this system, because
   everything downstream treats your output as the source of truth.
     Correct:   "took ${ILLEGIBLE_MARKER} yesterday"
     WRONG:     "took amoxicillin yesterday"   (guessed from a scrawl)
   One ${ILLEGIBLE_MARKER} per unreadable word or number. It is always better
   to mark something illegible than to guess it.

6. PRESERVE LAYOUT.
   Keep line breaks, list structure and indentation. Layout carries meaning
   in clinical notes -- a line under "Rx" means something different from a
   line under "Advice".

7. TRANSCRIBE THE HANDWRITTEN BODY ONLY.
   Indian OPD notes are usually written on printed letterhead. Skip the
   printed clinic name, address, phone number, registration number and any
   pre-printed form labels. Transcribe what the doctor wrote by hand. If a
   pre-printed label is filled in by hand, include the handwritten value.

8. IF THIS IS NOT HANDWRITTEN CLINICAL NOTES, REFUSE.
   If the image is a photograph of a person, a screenshot, a printed
   document with no handwriting, or anything else that is not handwritten
   clinical notes, reply with exactly:
   ${NOT_NOTES_TOKEN}
   and nothing else. Do not attempt a transcription.

Output the transcription as plain text. Do not add a preamble, a summary, a
translation, or any commentary. Do not wrap it in markdown or code fences.`

/** The user-turn instruction that accompanies the image. */
export const TRANSCRIBE_USER_PROMPT =
  'Transcribe the handwritten clinical notes in this image, following every rule exactly.'

/**
 * Temperature 0 -- transcription has one correct answer (§4.3).
 *
 * Any sampling at all is the model choosing between readings of the same
 * marks, which is precisely the choice we do not want it making.
 */
export const TRANSCRIBE_TEMPERATURE = 0

/**
 * Whether the model refused (E34, E18).
 *
 * Checks for the sentinel rather than matching refusal prose, and tolerates
 * the model wrapping it in whitespace or quotes.
 */
export function isRefusal(text: string): boolean {
  return text.trim().replace(/^["']|["']$/g, '') === NOT_NOTES_TOKEN
}

/** Count the illegible markers, for logging and the frontend's highlight. */
export function countIllegible(text: string): number {
  return text.split(ILLEGIBLE_MARKER).length - 1
}
