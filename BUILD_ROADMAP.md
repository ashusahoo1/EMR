# Build Roadmap — AI-Assisted Doctor Consultation Workspace

The executable companion to `EMR_PLAN.md`. That document decides **what** and **why**; this one decides **in what order**, **in which file**, and **what proves it done**.

**Reading rule:** `EMR_PLAN.md` wins on any disagreement about product decisions. This document wins on sequencing and file layout.

**Build order is strict:** Sector A (backend) → Sector B (AI) → Sector C (frontend). Each sector has numbered steps. A step is not finished until its **Done when** line is literally true — not "should work", but checked.

---

## Contents

- [Sector A — Backend](#sector-a--backend) — A0 through A9
- [Sector B — AI Pipeline](#sector-b--ai-pipeline) — B0 through B8
- [Sector C — Frontend](#sector-c--frontend) — C0 through C10
- [Sector D — Ship](#sector-d--ship) — D0 through D4
- [Appendix 1 — Full API contract](#appendix-1--full-api-contract)
- [Appendix 2 — Full database schema](#appendix-2--full-database-schema)
- [Appendix 3 — Error code table](#appendix-3--error-code-table)
- [Appendix 4 — Environment variables](#appendix-4--environment-variables)
- [Appendix 5 — Final file tree](#appendix-5--final-file-tree)
- [Appendix 6 — Feature → step traceability](#appendix-6--feature--step-traceability)
- [Appendix 7 — Edge case → test traceability](#appendix-7--edge-case--test-traceability)

---

## Ground rules that apply to every step

1. **One step, one commit.** The commit message is the step ID and title, e.g. `A3: drizzle schema + first migration`.
2. **Never skip forward.** If step A5 is blocked, fix the blocker — do not start A6. The ordering exists because later steps import earlier ones.
3. **The `Done when` line is a test, not a feeling.** Where it names a command, run the command.
4. **Write the decision down as you make it.** Every non-obvious choice goes straight into `AI_USAGE.md` §4 at the moment it is made. Reconstructing this at the end is the single most common way submissions lose marks.
5. **No secrets in the repo.** `.env` is gitignored from step A0, before any key exists to leak.
6. **TypeScript strict mode, no `any`.** If a type is hard, that is information about the design, not a reason for `any`.

---

# Sector A — Backend

Goal of this sector: a fully working Elysia API with a real database, seed data, validation and a consistent error contract — **with the AI endpoints stubbed**. At the end of Sector A the app is a functioning EMR that a doctor could use with zero AI. That is deliberate: it is the graceful-degradation guarantee (E23, §4.11) proven by construction rather than bolted on.

---

## A0 — Workspace skeleton

**Do**

1. `bun init` at the repo root. Delete the generated `index.ts`.
2. Create the directory tree:

```
apps/api/
apps/web/
packages/shared/
```

3. Root `package.json`:

```json
{
  "name": "emr-workspace",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:api": "bun --filter @emr/api dev",
    "dev:web": "bun --filter @emr/web dev",
    "test": "bun test",
    "test:eval": "bun test --test-name-pattern eval",
    "lint": "biome check .",
    "format": "biome format --write ."
  }
}
```

4. `.gitignore` — `node_modules`, `.env`, `.env.local`, `.next`, `dist`, `notes/` (the golden-set photos are never committed, §5.9).
5. `.env.example` with every key from [Appendix 4](#appendix-4--environment-variables), values blank.
6. `git init`, first commit.

**Done when:** `bun install` at root completes and `ls apps packages` shows the three workspace folders.

---

## A1 — Tooling: Biome + TypeScript strict

**Do**

1. `bun add -D @biomejs/biome` at root, `bunx biome init`.
2. In `biome.json`, enable the recommended rule set, set 2-space indent and single quotes; add `.next` and `dist` to `files.ignore`.
3. Root `tsconfig.base.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`, `"moduleResolution": "bundler"`.
4. `apps/api/tsconfig.json` and `packages/shared/tsconfig.json` both `extends` the base.

**Done when:** `bun run lint` exits 0 on the empty tree.

> **Why `noUncheckedIndexedAccess`:** the verification layer (B4) indexes into arrays of spans constantly. This flag is what stops a silent `undefined` becoming a false "grounded" verdict.

---

## A2 — `packages/shared`

This package holds everything both sides need. It must not import from `apps/`.

**Do**

1. `packages/shared/package.json` — name `@emr/shared`, `"main": "src/index.ts"` (no build step; Bun and Next both read TS directly).
2. `src/enums.ts` — the four enums from §7.2 as `const` objects plus derived union types:

```ts
export const AppointmentStatus = {
  Waiting: 'waiting',
  InConsultation: 'in_consultation',
  Completed: 'completed',
} as const
export type AppointmentStatus =
  (typeof AppointmentStatus)[keyof typeof AppointmentStatus]

export const ConsultationStatus = {
  Draft: 'draft',
  Confirmed: 'confirmed',
} as const
export type ConsultationStatus =
  (typeof ConsultationStatus)[keyof typeof ConsultationStatus]

export const GenerationType = {
  Transcription: 'transcription',
  Structuring: 'structuring',
} as const
export type GenerationType =
  (typeof GenerationType)[keyof typeof GenerationType]

export const VerificationStatus = {
  Passed: 'passed',
  Repaired: 'repaired',
  Flagged: 'flagged',
  Failed: 'failed',
} as const
export type VerificationStatus =
  (typeof VerificationStatus)[keyof typeof VerificationStatus]
```

3. `src/schema.ts` — the structured-note contract from §4.10, as TypeBox. **This one file is the spine of the entire project**: it validates the API boundary, it becomes the OpenAI strict JSON Schema, and it types the frontend form.

```ts
import { Type as t, type Static } from '@sinclair/typebox'

export const SourcedItem = t.Object(
  {
    text: t.String({ minLength: 1, maxLength: 500 }),
    sourceSpan: t.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
)

export const StructuredNote = t.Object(
  {
    chiefComplaint: t.Union([SourcedItem, t.Null()]),
    symptoms: t.Array(SourcedItem, { maxItems: 50 }),
    relevantHistory: t.Array(SourcedItem, { maxItems: 50 }),
    medicationsMentioned: t.Array(SourcedItem, { maxItems: 50 }),
    doctorPlan: t.Array(SourcedItem, { maxItems: 50 }),
    missingInformation: t.Array(t.String({ maxLength: 300 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
)
export type StructuredNote = Static<typeof StructuredNote>
```

4. `src/constants.ts` — limits in one place so client and server cannot drift:

```ts
export const LIMITS = {
  notesMaxChars: 10_000,        // E3
  notesMinChars: 1,             // E1
  imageMaxBytes: 8 * 1024 * 1024,
  imageMinWidth: 600,
  imageMinHeight: 600,
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  llmTimeoutMs: 45_000,
  maxRetries: 1,                // §4.6 — one retry, never a loop
} as const

export const PROMPT_VERSION = {
  transcription: 'transcribe-v1',
  structuring: 'structure-v1',
} as const
```

5. `src/index.ts` re-exports all three.

**Done when:** `bun -e "import {StructuredNote} from './packages/shared/src'; console.log(StructuredNote)"` prints the schema object.

> **Decision to record:** `chiefComplaint` is `SourcedItem | null`, not optional. A nullable field forces the model to make an explicit choice; an optional field lets it silently omit. Null is an answer, absence is ambiguity. Note N10 (three words of input) is the case that proves this matters.

---

## A3 — Database: Neon + Drizzle schema + first migration

> **Amended during the build:** local development runs **Docker Postgres 17**
> (`docker-compose.yml`, host port **15432**), not Neon. Neon remains the
> deployment target at D0 — the connection string is the only thing that
> changes, because Drizzle and the migration SQL are identical either way.
> Port 15432 rather than 5432 because this machine already runs an unrelated
> Postgres container plus two native `postgresql-x64` services occupying
> 5432, 5433 and 5435. A native service shadowing a published container port
> surfaces as a *password authentication failure*, not a connection error,
> which costs time to diagnose.

**Do**

1. `docker compose up -d`, then put the local URL in `apps/api/.env` as
   `DATABASE_URL`. (Original plan: create a Neon project and use its pooled
   connection string — still what D0 does.)
2. `cd apps/api && bun add drizzle-orm postgres && bun add -D drizzle-kit`.
3. `apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

4. Write `src/db/schema.ts` — the full five tables exactly as specified in [Appendix 2](#appendix-2--full-database-schema). Type them once, carefully; this is the step that is expensive to redo.
5. `src/db/client.ts` — a single exported `db` instance, `postgres(url, { max: 5 })`.
6. `bunx drizzle-kit generate` → produces `drizzle/0000_*.sql`. **Commit this file.** The brief grades migrations; a generated-at-deploy-time schema does not count.
7. `bunx drizzle-kit migrate` to apply.

**Done when:** the Neon dashboard shows five tables, and `drizzle/0000_*.sql` is committed.

> **Critical:** add the audit columns (`ai_generations` table, `raw_notes` / `ai_output` / `confirmed_output` on `consultations`) **now**, in this first migration. §3.5 flags this explicitly: free on day one, expensive to retrofit, and F13 is impossible without them.

---

## A4 — Seed data

**Do**

1. `src/db/seed.ts`, idempotent — `delete` in FK-safe order, then insert. Running it twice must produce the same database, not duplicates.
2. Seed contents:
   - **1 doctor** — `Dr. Anjali Verma`, General Medicine.
   - **8 patients** — reuse the names from `SYNTHETIC_NOTES_TEST.md` (Rahul Sharma, Priya Singh, Amit Kumar, Sunita Devi, Ramesh Iyer, Kavita Rao, Farhan Qureshi, Deepak Menon) with matching age/sex, plus realistic `allergies` and `existing_conditions` arrays. This makes the golden set and the seeded app tell one coherent story in the demo.
   - **Today's appointments** — 6 rows dated `CURRENT_DATE` at 09:00–12:30, statuses: 2 completed, 1 in_consultation, 3 waiting. **Dates must be relative to today**, never hardcoded, or the dashboard is empty on the reviewer's machine.
   - **Past consultations** — 2 patients get 2 prior confirmed consultations each, with fully populated structured notes, so F3 (history) is not empty on first click.
   - **1 patient with zero history** — Kavita Rao — to force the empty state (E28) to be visible in the demo rather than theoretical.
3. Add `"db:seed": "bun run src/db/seed.ts"` to `apps/api/package.json`.

**Done when:** `bun run db:seed` twice in a row leaves exactly 6 appointments, not 12.

---

## A5 — Elysia app shell + error contract

This step establishes the shape every later route follows. Get it right once.

**Do**

1. `bun add elysia @elysiajs/cors @elysiajs/swagger`.
2. `src/errors.ts` — one `AppError` class carrying `code`, `httpStatus`, `message`, optional `details`. Codes come from [Appendix 3](#appendix-3--error-code-table) and nothing else.
3. `src/app.ts` — build and export the app, **do not listen here**:

```ts
export const app = new Elysia()
  .use(cors({ origin: process.env.WEB_ORIGIN }))
  .use(swagger())
  .onError(({ error, set }) => { /* map to the envelope below */ })
  .get('/health', () => ({ ok: true }))
export type App = typeof app
```

4. `src/index.ts` — imports `app` and calls `.listen(PORT)`.

**The split in 3/4 is not stylistic.** Eden Treaty's in-process test mode (§2.5) needs to import the app object without a port being bound. If `app.ts` listens, every integration test fights over a port.

5. Error envelope, identical on every failure — no exceptions:

```json
{
  "error": {
    "code": "NOTES_TOO_LONG",
    "message": "Notes exceed the 10,000 character limit.",
    "details": { "length": 12480, "limit": 10000 }
  }
}
```

6. `onError` maps: `AppError` → its own status; Elysia `VALIDATION` → 422 `VALIDATION_FAILED` with the field path in `details`; `NOT_FOUND` → 404; anything else → 500 `INTERNAL_ERROR` with a **generic** message. Log the real error server-side; never return a stack trace (E20, E37).

**Done when:** `curl localhost:3001/health` returns `{"ok":true}` and `curl localhost:3001/nope` returns the envelope with `code: "NOT_FOUND"`.

---

## A6 — Read routes (F1, F2, F3)

Endpoint shapes are fully specified in [Appendix 1](#appendix-1--full-api-contract). Build in this order:

| Order | Endpoint | Feature |
|---|---|---|
| 1 | `GET /appointments?date=` | F1 |
| 2 | `GET /patients/:id` | F2 |
| 3 | `GET /patients/:id/consultations` | F3 |
| 4 | `GET /consultations/:id` | F6 reload |
| 5 | `GET /search?q=` | F17 |

**Rules for all five**

- Every route declares `params`/`query`/`response` with TypeBox. A route without a response schema breaks Eden's inference and silently degrades the frontend to `any`.
- Business logic goes in `src/services/*.ts`; the route file only validates, calls, and returns. Services are what the tests in A9 exercise directly.
- A missing row throws `AppError('PATIENT_NOT_FOUND', 404)` — never returns `null` with a 200.
- `GET /appointments` with no `date` defaults to today, server-side.

**Done when:** all five return correct seeded data via curl, and a bad UUID returns 422 rather than a 500.

---

## A7 — Write routes (F4, F7, F15)

| Endpoint | Feature | Note |
|---|---|---|
| `POST /consultations` | F4 | Creates a draft. Body: `appointmentId`, `rawNotes`. |
| `PATCH /consultations/:id` | F6 | Saves edits to the draft. |
| `POST /consultations/:id/confirm` | F7 | Draft → confirmed. **Idempotent.** |
| `PATCH /appointments/:id/status` | F15 | Guarded transitions. |

**Two things that are easy to get wrong**

1. **Confirm must be idempotent (E25).** Double-clicking Save must not create two consultations or two audit rows. Implement as a conditional update — `UPDATE ... WHERE id = $1 AND status = 'draft'` — and treat zero affected rows as success if the row is already confirmed, `409 ALREADY_CONFIRMED` only if it does not exist in a valid state. Do not rely on the UI disabling the button; the test in A9 calls the endpoint twice directly.
2. **Status transitions are validated server-side (E31).** A transition map in code: `waiting → in_consultation → completed`, plus `in_consultation → waiting` as an undo. Everything else is `409 INVALID_STATUS_TRANSITION`. §5.6 is explicit that hiding an invalid transition in the UI does not count.

**Done when:** `POST /consultations/:id/confirm` called twice returns 200 both times with one row in the table, and `completed → waiting` returns 409.

---

## A8 — AI endpoint stubs

Define the AI routes now, with the real contract, returning canned data. Sector C can then be built against a stable API even if Sector B is mid-flight.

**Do**

1. `POST /consultations/:id/structure` → returns a hardcoded valid `StructuredNote` for the N01 fixture, with `verification: { status: 'passed', flags: [] }`.
2. `POST /transcribe` → accepts multipart, returns fixed text.
3. Both read `LLM_ENABLED`. When `false`, they return `503 AI_UNAVAILABLE` — which is exactly the E23 path, so the degradation story gets tested from day one rather than at the end.

**Done when:** the frontend contract is complete and `LLM_ENABLED=false` produces a clean 503 envelope, not a crash.

---

## A9 — Backend test suite (L2)

**Do**

1. `bun add -D @elysiajs/eden`.
2. `src/tests/helpers.ts` — `treaty(app)`, plus a `resetDb()` that truncates and re-seeds.
3. `src/tests/flow.test.ts` — **the single most valuable test in the repo.** It must walk the entire path in one test, because §5.2 states plainly that with E2E dropped, this is what proves the brief's 25% end-to-end criterion:

```
GET /appointments (today)
  → pick a waiting one
  → PATCH status to in_consultation
  → POST /consultations (raw notes)
  → POST /consultations/:id/structure (stubbed LLM)
  → PATCH /consultations/:id (doctor edits a field)
  → POST /consultations/:id/confirm
  → GET /patients/:id/consultations   ← it must appear here
  → PATCH appointment status to completed
```

4. `src/tests/errors.test.ts` — one named test per error code in Appendix 3.
5. `src/tests/idempotency.test.ts` — E25 (double confirm) and E31 (illegal transition).

**Done when:** `bun test` is green, and the flow test fails loudly if any single link in the chain is broken.

---

### Sector A exit criteria

Do not start Sector B until every line is true:

- [ ] `bun test` green
- [ ] `bun run lint` clean
- [ ] Seed is idempotent and dated relative to today
- [ ] Migration SQL committed
- [ ] Every route has request **and** response schemas
- [ ] Every error path returns the envelope, never a stack trace
- [ ] `LLM_ENABLED=false` leaves the API fully usable

---

# Sector B — AI Pipeline

Goal: the six stages of §4, built in an order where **the testable, deterministic part comes before the non-deterministic part**. Verification (B4) is deliberately built before the structuring prompt is tuned, so the prompt gets tuned against a working checker rather than against vibes.

---

## B0 — The `llm/` seam

**Do**

1. `bun add openai`.
2. `src/llm/types.ts` — the interface, and nothing about OpenAI in it:

```ts
export interface LlmClient {
  transcribeImage(input: {
    image: Uint8Array
    mimeType: string
  }): Promise<{ text: string; meta: CallMeta }>

  structureNotes(input: {
    notes: string
    repairFeedback?: string      // the one retry, §4.6
  }): Promise<{ raw: unknown; meta: CallMeta }>
}

export interface CallMeta {
  model: string
  promptVersion: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
}
```

3. `src/llm/openai.ts` — the real implementation.
4. `src/llm/stub.ts` — a fixture-driven fake used by every L2 test.
5. `src/llm/index.ts` — picks one based on `LLM_ENABLED` and `NODE_ENV`.

**Why this seam exists (record it):** not provider portability — **testability**. §2.3 is explicit. Without it, every integration test has to mock the OpenAI SDK's internals, which is brittle and unreadable. `CallMeta` is here because §4.8 requires model name and prompt version in the audit trail; retrofitting it means re-plumbing every call site.

**Done when:** A9's tests import the stub and never touch the network.

---

## B1 — Stage 0: upload precheck

**Do** — in `src/services/upload.ts`, before any model call:

| Check | Fail code |
|---|---|
| MIME type in `allowedImageTypes` | `INVALID_IMAGE_TYPE` |
| Size ≤ `imageMaxBytes` | `IMAGE_TOO_LARGE` |
| Decodes as a real image | `CORRUPT_IMAGE` |
| Width and height ≥ minimums | `IMAGE_TOO_SMALL` |
| Blur score above threshold | `IMAGE_TOO_BLURRY` |

Blur detection: variance of the Laplacian over a grayscale downscale. A rough threshold is fine — this is a cheap filter, not a science. Getting it slightly wrong costs a retake; skipping it costs a model call that returns confident nonsense (§4.2).

Enforce the size cap server-side independently of the client (E32, E33).

**Done when:** a text file renamed `.jpg`, a 20 MB image, and a 100×100 image each return their own specific code, and no model call was made.

---

## B2 — Stage 1: transcription prompt

**Do**

1. `src/llm/prompts/transcribe.ts`, versioned `transcribe-v1`.
2. Encode every rule from §4.3 as a numbered instruction: transcribe verbatim · do not correct spelling · **do not expand abbreviations** (`PCM` stays `PCM`) · do not infer · mark unreadable text `[illegible]` · preserve line breaks · skip printed letterhead, transcribe the handwritten body · refuse non-clinical images.
3. **Temperature 0.**
4. Runaway guard: if output length is wildly disproportionate to the image, fail rather than return (E36).
5. Refusal path returns `NOT_CLINICAL_NOTES`, distinct from a technical error (E34, E18).

**Done when:** N02 transcribes with `PCM` and `x2d` intact, and N08 contains `[illegible]`.

> **The `[illegible]` rule is the highest-stakes line in the entire prompt.** §4.3: a fabrication here is invisible to every downstream check, because by the time stage 4 runs, the fabrication *is* the source text. N08 is the note that tests it and it is one of the three non-negotiables in `SYNTHETIC_NOTES_TEST.md`.

---

## B3 — Stage 3: structuring prompt

**Do**

1. `src/llm/prompts/structure.ts`, versioned `structure-v1`.
2. Convert `StructuredNote` (A2) to JSON Schema and pass it as OpenAI strict structured output. TypeBox *is* JSON Schema, so this should be a direct handoff (§2.3). If strict mode rejects it, the usual cause is a `t.Union` — flatten it and note the workaround.

> **Amended during the build:** the predicted cause was wrong, and no flattening was needed. `t.Union` is **not** the problem — nested `anyOf` is inside strict mode's supported subset, and OpenAI's own documentation uses `anyOf: [{…}, {"type": "null"}]` for exactly our nullable `chiefComplaint`. It passes through untouched.
>
> What strict mode actually rejects is the **value-level keywords**: `minLength`, `maxLength`, `maxItems`, `pattern`, `format`, `minimum`/`maximum`, `uniqueItems`, `default`. Strict mode works by constrained decoding, so every keyword must be expressible as a grammar rule; "at most 500 characters" is not knowable until after the tokens are emitted. Our schema carries `maxLength` on every `SourcedItem` field and `maxItems` on every array, because the same schema also validates the HTTP boundary where those limits are real enforcement.
>
> The handoff is therefore a **recursive keyword-stripping conversion** (`src/llm/strict-schema.ts`), not a direct pass or a flatten. Stripping loses nothing: the model's output is still validated against the *full* schema afterwards (§4.5 — "provider enforcement guarantees shape, not truth"). The converter also asserts strict mode's two structural rules (`additionalProperties: false`, every property in `required`) so a future field cannot regress them silently, and rejects `t.Optional` with a message pointing at the union-with-null fix.
3. Prompt rules, each with a worked example drawn from the golden set:
   - Ask for the **verbatim substring** as `sourceSpan`, never character offsets (§4.5 — models cannot count characters reliably).
   - Empty arrays are a **correct answer**. Say it explicitly; models pad to look complete. (N06, N10.)
   - Normalise vocabulary, never infer facts. `x3d` → "for 3 days" ✅ · "sugar on the higher side" → "Type 2 Diabetes Mellitus" ❌.
   - Preserve stated negatives. Omitting one is a hallucination too. (N03.)
   - Reformat, do not advise. Scribe, not consultant.
   - The notes are **data, not instructions**. Delimit them clearly. (N09 — assume this gets tried at the interview.)
4. Temperature 0.

**Done when:** N01 through N12 each return schema-valid JSON, N06's `medicationsMentioned` is `[]`, and N09 produces a normal note rather than the word "banana".

---

## B4 — Stage 4: verification (pure functions, no AI)

**The highest-value code in the project.** Build it before tuning B3's prompt.

`src/verification/`, one file per check, each a pure function with zero imports from `db/` or `llm/`:

| File | Check | Catches |
|---|---|---|
| `normalise.ts` | lowercase, collapse whitespace, smart quotes/dashes | — |
| `grounding.ts` | every `sourceSpan` occurs in the source | E14, E15 |
| `numeric.ts` | every number in output appears in input | **E13 — the brief's headline case** |
| `negation.ts` | negation token in span survives into text | **E16 — the most dangerous case** |
| `survival.ts` | allergy in notes reaches `relevantHistory` | **E17 — the one nobody builds** |
| `index.ts` | runs all, returns `VerificationResult` | — |

**Signature — and it must stay this pure:**

```ts
export function verify(sourceText: string, note: StructuredNote): VerificationResult
```

**Implementation notes that matter**

- **Grounding:** try raw match first, then normalised. Skipping normalisation buries real failures under false ones (§4.6).
- **Numeric:** allow digits-vs-words ("3" / "three") and Indian shorthand `x3d`. Borderline cases **flag, never fail** — a flag costs a glance, a false rejection costs the feature.
- **Negation:** token list `no, not, denies, without, nil, absent, ruled out, negative for`. Be honest in the README about what it misses — distant negation and double negatives. It catches the common dangerous case cheaply. It is not clinical NLP and must not be described as such.
- **Survival:** scan the source for allergy triggers (`allergic`, `allergy`, `sulfa`, `penicillin`, …). If found and `relevantHistory` has no matching item, flag. This is the **reverse-direction** check — grounding validates what is present and by definition can never catch an omission.

**Severity tiers** (§4.6) — hard fail / repairable / soft flag / pass, exactly as tabled.

**Done when:** every L1 test below is green.

---

## B5 — L1 verification tests

`src/verification/*.test.ts`. One **named** test per case, hand-written fixtures, no network, no mocks, milliseconds to run.

Minimum set — E11 through E17, plus:

```
✓ invented BP is caught by numeric containment          (E13, N05)
✓ ungrounded span is flagged                            (E14)
✓ paraphrased span matches after normalisation          (E15)
✓ "no cough" → "Cough" is caught by negation            (E16, N03)
✓ dropped penicillin allergy is caught by survival      (E17, N04)
✓ empty arrays pass clean, not flagged                  (E4, N06)
✓ "x3d" → "for 3 days" does not trip numeric            (E10, N02)
✓ legitimate "3 days" passes numeric containment
✓ extra key is rejected by additionalProperties         (E12)
```

**Done when:** `bun test src/verification` green, and it runs without an API key set — the proof that it is genuinely a pure layer.

> This is the answer to "how do you test non-deterministic AI output": **you do not test the model, you test the layer that constrains it** (§5.1). Be ready to say that sentence in the interview.

---

## B6 — Wire the real pipeline

Replace the A8 stubs.

**`POST /consultations/:id/structure`**

```
load consultation
  → llm.structureNotes(rawNotes)
  → parse + schema-validate
  → verify(rawNotes, note)
  → if repairable: ONE retry with errors fed back, re-verify
  → write an ai_generations row (input, raw output, model,
    promptVersion, verification result, latency, tokens)
  → return { note, verification }
```

**Non-negotiables here**

- **One retry, never a loop** (§4.6). Unbounded retries burn cost and latency and rarely converge.
- **Flag, never silently drop.** Deleting data behind a doctor's back is worse than showing them something suspect.
- Write the `ai_generations` row **even when verification fails** — a failed generation is exactly what an audit trail is for.
- Timeout every call at `llmTimeoutMs` (E22).
- `sourceSpan` never reaches the client in the doctor-facing payload shape beyond what provenance highlighting needs — it is machinery, not content (§4.5).

**`POST /transcribe`** — precheck (B1) → transcribe (B2) → write an `ai_generations` row of type `transcription` → return text. **Never auto-chain into structuring** (§4.4): stage 2's human checkpoint is the entire product thesis.

**Done when:** a real call on N01 returns a verified note and exactly one `ai_generations` row exists.

---

## B7 — Cross-cutting guardrails

Each is small; skipping them is what §4.11 warns about, because they only surface when something breaks — which, during a live demo, it will.

- [x] API key server-side only, never in any client response (E37 — the brief names this as its own example of good engineering)
- [x] Timeout on every model call (E22)
- [x] Rate limit on `/structure` and `/transcribe` (E21)
- [x] Token/cost cap per request
- [x] Structured log per AI call: latency, tokens, verification outcome
- [x] **Graceful degradation:** provider down → doctor still writes and saves free-text notes (E23). Already true by construction if Sector A was built first. **Verify it, do not assume it.**

**Done when:** `LLM_ENABLED=false`, full consultation still creatable and savable end to end.

> **Built at B7.** Three of the six were already true (timeout from B0, structured logging from B6, degradation from A8's `LLM_ENABLED` gate) and were *verified* rather than assumed, as the roadmap insists. The two genuinely new pieces:
>
> **Rate limiter** (`src/rate-limit.ts`) — sliding window, not fixed. A fixed window allows 2× the limit across a boundary (20 calls at :59 plus 20 at :01), which is exactly the burst being prevented. Applied via `onBeforeHandle` on the AI route group only: read and write endpoints stay unthrottled, so a doctor who exhausts the AI budget can still save their note. Rejected attempts are deliberately *not* recorded, or an over-eager retrying client would extend its own lockout indefinitely.
>
> **Token caps** (`LIMITS.transcribeMaxOutputTokens` / `structureMaxOutputTokens`) — the rate limiter bounds request *count*; these bound *spend*, which is the real money guardrail since one large note costs more than ten small ones. A response that hits the cap is a **failure, not a partial result**: a truncated transcript is the most dangerous output of stage 1, because it looks complete while the drug and dose may have been silently cut off.
>
> **Known limitations**, for the README: the limiter is in-process (resets on restart, not shared across replicas) and IP-keyed (shared NAT shares a bucket; `x-forwarded-for` is spoofable). Both are fixed by F21 auth plus Redis, and neither matters at one process serving one clinic.

---

## B8 — L3 golden-set eval

**Do**

1. Photograph the twelve notes from `SYNTHETIC_NOTES_TEST.md` by hand. Vary pen, paper, lighting, angle.
2. Store `notes/N01.jpg` + `N01.txt` + `N01.json`. **Gitignored** — never committed.
3. `src/tests/eval.test.ts`, tagged so it is excluded from CI.
4. Score **hallucinations and omissions separately**. Averaging them hides both.
5. Record results in the README.

**Not in CI** (§5.2): it costs money, it is non-deterministic, and a red build caused by model drift trains people to ignore red builds. Run it before submission and whenever a prompt changes.

**Calibration to state in the README:** MIRAGE — a *fine-tuned* model on Indian handwritten prescriptions — reports 82% on medication name and dosage extraction. A generic VLM misreading a drug name is the **expected floor, not a bug**. That is precisely why stage 2's human checkpoint exists.

---

### Sector B exit criteria

- [ ] `bun test` green with no API key set (L1 + L2 both run offline)
- [ ] N04, N05, N08 pass consistently — the three non-negotiables
- [ ] One retry maximum, provable in the logs
- [ ] `ai_generations` written on both success and failure
- [ ] `LLM_ENABLED=false` still fully usable

---

# Sector C — Frontend

Goal: Next.js App Router, Eden Treaty for end-to-end types, TanStack Query for the loading/error/empty states the brief grades explicitly.

---

## C0 — Next.js + Eden wiring

**Do**

1. `bunx create-next-app@latest apps/web` — App Router, TypeScript, Tailwind, no `src/` dir.
2. `bun add @elysiajs/eden @tanstack/react-query`, and `@emr/api` + `@emr/shared` as workspace deps.
3. `lib/api.ts`:

```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@emr/api/src/app'
export const api = treaty<App>(process.env.NEXT_PUBLIC_API_URL!)
```

4. QueryClient provider in `app/providers.tsx`.
5. `bunx shadcn@latest init`, add: button, card, dialog, input, textarea, badge, skeleton, sonner, alert, tabs.

**Done when:** a component calls `api.appointments.get()` and **autocomplete shows the real response fields**. If it shows `any`, stop and fix the type import — §2.2 calls this the one setup step Eden requires, and it must work before anything else is built.

> **Amended during the build:** the scaffold came out as **Next 16.3.6 / React 19.2**, which ships an `AGENTS.md` warning that its APIs differ from model training data. The change that matters for C3/C4: `params` and `searchParams` are **Promises**, with `PageProps<'/route'>` and `LayoutProps<'/route'>` helpers generated by `next typegen`. Synchronous access is fully removed, not merely deprecated.
>
> Two deviations from the step as written. `create-next-app` installs ESLint regardless of the flag, so it was removed — Biome already lints the workspace and two linters disagreeing is worse than either alone. And `apps/web/tsconfig.json` **extends `tsconfig.base.json`** rather than keeping the generated defaults, so the frontend inherits `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. That caught a real type error in shadcn's vendored `sonner.tsx` on the first run.
>
> `allowImportingTsExtensions` must stay **true** in the web app: Eden pulls the API's `App` type from source, which drags in the whole `apps/api` + `packages/shared` graph, and both use explicit `.ts` specifiers because Bun executes TypeScript directly. Turning it off produced ~40 TS5097 errors in files the web app does not own.
>
> **How the done-when was verified.** Autocomplete cannot be asserted in CI, so `lib/api.types-check.ts` encodes it: deliberate mistakes marked `@ts-expect-error`, checked by `bun run typecheck`. It fails in *both* directions — if inference breaks the positive assertions stop compiling, and if the client degrades to `any` the directives report "unused `@ts-expect-error`". Confirmed by temporarily replacing the `App` import with `any`: both signatures appeared. The file is **not** named `.test.ts`, because its `declare const` bindings have no runtime value and `bun test` would fail on them.
>
> Independently, the first draft of `app/page.tsx` guessed `appointment.patientName` and the compiler rejected it — the real shape nests `patient: { name, age, sex }`. That error is only possible with live inference, which is the done-when demonstrated by accident.
>
> Ports: **3000 was occupied** by an unrelated application on this machine (the same class of collision as 3001 and 5432 earlier), so `next dev` selected 3004 and an initial curl was reading a stranger's app. The API stays on 4000; CORS verified with an explicit `Origin: http://localhost:3000` preflight.

---

## C1 — Shell and states

**Do**

1. `app/layout.tsx` — doctor name header, providers, toaster.
2. Three reusable components built **once**, used everywhere: `<LoadingState/>` (skeleton, not a spinner), `<ErrorState/>` (with retry), `<EmptyState/>` (icon + message + optional action).
3. `app/error.tsx` and `app/not-found.tsx`.

**Done when:** all three render in isolation. F12 is graded across *every* view, so build them before the views, not after.

---

## C2 — F1 Appointments dashboard

`app/page.tsx`. Today's list: time · patient name · reason · status badge. Rows clickable → patient page. Status filter tabs. Three states wired.

**Done when:** seeded appointments render, and an empty date shows the empty state rather than a blank panel or an eternal spinner (E28).

---

## C3 — F2 + F3 Patient profile and history

`app/patients/[id]/page.tsx`. Demographics · **allergies prominently, visually distinct** · existing conditions · consultation history, most recent first, each expandable to the full structured note.

**Done when:** Kavita Rao (zero history) shows the empty state, and an allergic patient's allergy is impossible to miss.

---

## C4 — F4 Consultation composer

`app/consultations/[id]/page.tsx`. Big textarea, char counter against `notesMaxChars`, autosave draft to the API on debounce. **Generate disabled while empty or whitespace-only** (E1) and while a call is in flight (E24).

**Done when:** typing and refreshing preserves the draft; Generate cannot be double-fired.

---

## C5 — F8 Image upload

Dropzone + camera capture on mobile (`capture="environment"`). Client-side type/size check and downscale before upload — then the server checks again independently.

Transcribed text lands **in the normal editable textarea**, visibly marked machine-transcribed until edited. `[illegible]` markers highlighted so the doctor's eye goes straight to them.

**Never auto-trigger Generate** (§4.4). The doctor presses it.

**Done when:** a photo produces editable text, `[illegible]` is visually obvious, and structuring did not fire on its own.

---

## C6 — F5 + F6 Draft review and edit

The heart of the product.

- Every field editable — **no read-only AI output, no exceptions**
- AI-generated vs doctor-confirmed **visually distinct** (F14 — listed under the brief's UX criteria)
- Flagged items marked "unverified" **with the reason shown**, e.g. *"'BP 130/80' does not appear in your notes"*
- `missingInformation` as a **dismissible nudge above the save button — never a blocker** (§4.7, the HealthPlix drug-interaction-nudge precedent). Do not prevent saving because temperature was not recorded; blocking a doctor mid-clinic is how EMRs get abandoned
- Add/remove items in every array
- Regenerating after edits **asks first** (E30)

**Done when:** every field is editable, flags show their reason in plain language, and the nudge never blocks the save.

---

## C7 — F7 Save + F15 status

Confirm button → `POST /confirm` → toast → the consultation appears in patient history. Advance appointment status. Save disabled while in flight (E25 on the client too, in addition to the server guarantee from A7).

**Done when:** saving once produces exactly one history entry, and it is visible immediately.

---

## C8 — F16 Unsaved-work protection

`beforeunload` plus an App Router navigation guard, driven by a dirty-state flag on the draft form.

**Done when:** editing then navigating away prompts; a clean form does not (E26).

---

## C9 — F17 Search

Header search, debounced, patients and consultations. Empty-result state.

**Done when:** a partial name returns matches and a nonsense query shows the empty state.

---

## C10 — Polish pass

Responsive down to tablet · keyboard navigation · focus rings · `aria-label`s on icon buttons · real `<title>`s · a favicon · no console errors.

**Done when:** a full run-through on a phone-width viewport reveals nothing broken.

---

### Sector C exit criteria

- [ ] Every view has loading, error and empty states
- [ ] Eden types flow end to end — zero `any` at the API boundary
- [ ] AI vs confirmed content visually distinguishable
- [ ] Unsaved-work guard fires
- [ ] No console errors anywhere

---

# Sector D — Ship

## D0 — Deploy

Backend → Railway or Fly (**not Vercel — Bun does not run on Vercel's serverless functions**, §2.3, the single biggest deployment gotcha). Frontend → Vercel. DB → Neon. Run migrations on deploy; seed once manually.

**Done when:** the deployed frontend talks to the deployed backend and the seeded dashboard loads.

---

## D1 — `README.md`

Setup · env vars · architecture diagram · **scope decisions stated as decisions**:

- F8 photo input is our product addition, not in the brief (§3.5)
- The uploaded image is deliberately not persisted (§2.3)
- No E2E / component tests, and why L2 covers it (§5.10)
- Known limitation: no auth, so patient access is not isolated (E38) — **state it, do not pretend it is handled**
- Negation checking is a word-list heuristic, not clinical NLP
- Golden-set eval results with hallucination and omission counted separately

---

## D2 — `AI_USAGE.md`

Sections 1–3 per the brief, and §4 from the decisions table in `EMR_PLAN.md` §6 — which should already be filled in from ground rule 4, not reconstructed now.

---

## D3 — CI

GitHub Actions: `bun install` → `lint` → `test`. L3 eval **excluded** (§5.2).

---

## D4 — Demo rehearsal

Fresh clone, fresh `.env`, `bun install`, migrate, seed, run. Walk the whole flow once. **Then run it once with `LLM_ENABLED=false`** — that is the path most likely to be exercised by conference wifi during a live demo, and it is the strongest available answer to "what would you do differently in production".

---

# Appendix 1 — Full API contract

Base: `/`. All bodies JSON except `/transcribe` (multipart). All errors use the A5 envelope.

### `GET /health`
→ `200 { ok: true }`

### `GET /appointments?date=YYYY-MM-DD`
`date` optional, defaults to today.
```ts
200 { appointments: Array<{
  id: string
  scheduledAt: string          // ISO
  reason: string
  status: AppointmentStatus
  patient: { id: string; name: string; age: number; sex: 'M'|'F'|'O' }
  consultationId: string | null
}> }
```

### `GET /patients/:id`
```ts
200 { patient: {
  id: string; name: string; age: number; sex: 'M'|'F'|'O'
  phone: string | null
  allergies: string[]
  existingConditions: string[]
} }
404 PATIENT_NOT_FOUND
```

### `GET /patients/:id/consultations`
Most recent first, confirmed only.
```ts
200 { consultations: Array<{
  id: string
  createdAt: string
  rawNotes: string
  confirmedNote: StructuredNote | null
  status: ConsultationStatus
}> }
```

### `GET /consultations/:id`
```ts
200 { consultation: {
  id: string; appointmentId: string; patientId: string
  rawNotes: string
  aiNote: StructuredNote | null
  confirmedNote: StructuredNote | null
  status: ConsultationStatus
  verification: VerificationResult | null
  createdAt: string; updatedAt: string
} }
404 CONSULTATION_NOT_FOUND
```

### `POST /consultations`
```ts
body { appointmentId: string; rawNotes?: string }
201  { consultation: {...} }
404  APPOINTMENT_NOT_FOUND
409  CONSULTATION_EXISTS      // one per appointment
```

### `PATCH /consultations/:id`
```ts
body { rawNotes?: string; confirmedNote?: StructuredNote }
200  { consultation: {...} }
409  ALREADY_CONFIRMED        // confirmed consultations are immutable
422  NOTES_TOO_LONG
```

### `POST /consultations/:id/confirm`
**Idempotent.**
```ts
body { confirmedNote: StructuredNote }
200  { consultation: {...} }
404  CONSULTATION_NOT_FOUND
```

### `POST /consultations/:id/structure`
```ts
body { }                      // uses the stored rawNotes
200  { note: StructuredNote, verification: VerificationResult }
422  NOTES_EMPTY | NOTES_TOO_LONG
502  AI_GENERATION_FAILED     // after the one retry
503  AI_UNAVAILABLE
504  AI_TIMEOUT
429  RATE_LIMITED
```

### `POST /transcribe`
```ts
multipart { image: File }
200  { text: string, hasIllegible: boolean }
422  INVALID_IMAGE_TYPE | IMAGE_TOO_LARGE | IMAGE_TOO_SMALL
     | CORRUPT_IMAGE | IMAGE_TOO_BLURRY | NOT_CLINICAL_NOTES
503  AI_UNAVAILABLE
504  AI_TIMEOUT
```

### `PATCH /appointments/:id/status`
```ts
body { status: AppointmentStatus }
200  { appointment: {...} }
409  INVALID_STATUS_TRANSITION
```

### `GET /search?q=`
```ts
200 { patients: [...], consultations: [...] }
422 QUERY_TOO_SHORT           // min 2 chars
```

### `VerificationResult`
```ts
{
  status: VerificationStatus
  flags: Array<{
    field: 'chiefComplaint'|'symptoms'|'relevantHistory'
         |'medicationsMentioned'|'doctorPlan'
    index: number | null
    check: 'grounding'|'numeric'|'negation'|'survival'|'schema'
    severity: 'hard'|'repairable'|'soft'
    message: string            // doctor-readable, shown in the UI
  }>
  repaired: boolean
}
```

---

# Appendix 2 — Full database schema

All ids `uuid` with `gen_random_uuid()`. All timestamps `timestamptz` defaulting to `now()`.

### `doctors`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| specialty | text | |
| created_at | timestamptz | |

### `patients`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| age | integer NOT NULL | |
| sex | text NOT NULL | `M`/`F`/`O` |
| phone | text | |
| allergies | text[] NOT NULL DEFAULT '{}' | drives the E17 survival check story |
| existing_conditions | text[] NOT NULL DEFAULT '{}' | |
| created_at | timestamptz | |

Index: `patients(name)` for F17 search.

### `appointments`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| doctor_id | uuid FK → doctors | |
| patient_id | uuid FK → patients | |
| scheduled_at | timestamptz NOT NULL | |
| reason | text | |
| status | text NOT NULL DEFAULT 'waiting' | `AppointmentStatus` |
| created_at | timestamptz | |

Index: `appointments(scheduled_at)`, `appointments(status)`.

### `consultations`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| appointment_id | uuid FK UNIQUE | one per appointment |
| patient_id | uuid FK | denormalised for F3 |
| raw_notes | text NOT NULL DEFAULT '' | stage 2 output — doctor-corrected |
| ai_note | jsonb | **raw AI output, unmodified** |
| confirmed_note | jsonb | **doctor-confirmed version** |
| verification | jsonb | last verification result |
| status | text NOT NULL DEFAULT 'draft' | `ConsultationStatus` |
| created_at / updated_at | timestamptz | |

Index: `consultations(patient_id, created_at DESC)` — F3's exact query.

> `ai_note` and `confirmed_note` are **separate columns on purpose** (§4.8, F13). Overwriting one with the other destroys the only evidence of what the doctor changed.

### `ai_generations`
One row per model call. §7.3: a column cannot hold several attempts; a row per attempt can.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| consultation_id | uuid FK | |
| type | text NOT NULL | `GenerationType` — both stages, one table |
| input | text NOT NULL | notes, or an image reference |
| raw_output | jsonb NULL | exactly what came back; null when the call produced none |
| model | text NOT NULL | **§4.8: without this the audit trail is uninterpretable in six months** |
| prompt_version | text NOT NULL | same reason |
| verification_status | text | `VerificationStatus` |
| verification_flags | jsonb | |
| latency_ms | integer | |
| input_tokens / output_tokens | integer | |
| error_code | text | populated on failure — failures are audited too |
| created_at | timestamptz | |

Index: `ai_generations(consultation_id, created_at)`.

**The image is never stored** (§2.3, F17 scope decision). Only the transcript.

> **Amended during the build (B6):** `raw_output` was originally `NOT NULL`. That contradicted B6's own requirement to "write the `ai_generations` row **even when** verification fails" — a call that timed out or was refused produced no output, so the insert failed and the audit row silently vanished. Found because the graceful-degradation design worked as intended: the request still returned a correct `504`, and only the error log showed the write had failed.
>
> Made nullable rather than given a placeholder value, because a placeholder would make "no output" indistinguishable from "the model returned null" — precisely the distinction the trail exists to record. Migration `0001_flimsy_swordsman.sql`.

---

# Appendix 3 — Error code table

| Code | HTTP | Meaning | Edge case |
|---|---|---|---|
| `VALIDATION_FAILED` | 422 | Schema validation failed | — |
| `NOT_FOUND` | 404 | Unknown route | — |
| `PATIENT_NOT_FOUND` | 404 | | |
| `APPOINTMENT_NOT_FOUND` | 404 | | |
| `CONSULTATION_NOT_FOUND` | 404 | | |
| `CONSULTATION_EXISTS` | 409 | One per appointment | |
| `ALREADY_CONFIRMED` | 409 | Confirmed notes are immutable | |
| `INVALID_STATUS_TRANSITION` | 409 | Rejected at the API, not just the UI | E31 |
| `NOTES_EMPTY` | 422 | Whitespace-only | E1 |
| `NOTES_TOO_LONG` | 422 | Over 10,000 chars | E3 |
| `QUERY_TOO_SHORT` | 422 | Search under 2 chars | |
| `INVALID_IMAGE_TYPE` | 422 | | E32 |
| `IMAGE_TOO_LARGE` | 422 | | E32 |
| `IMAGE_TOO_SMALL` | 422 | Below resolution threshold | E33 |
| `CORRUPT_IMAGE` | 422 | Does not decode | E32 |
| `IMAGE_TOO_BLURRY` | 422 | Precheck rejection, no model call spent | E33 |
| `NOT_CLINICAL_NOTES` | 422 | Model refused — distinct from a technical error | E34, E18 |
| `AI_GENERATION_FAILED` | 502 | Failed after the one retry | E19 |
| `AI_UNAVAILABLE` | 503 | Provider down or `LLM_ENABLED=false` | **E23** |
| `AI_TIMEOUT` | 504 | | E22 |
| `RATE_LIMITED` | 429 | Honest message, not a generic failure | E21 |
| `INTERNAL_ERROR` | 500 | **Generic message only — never a stack trace** | E20, E37 |

---

# Appendix 4 — Environment variables

> **Amended during the build:** the API listens on **4000**, not 3001, and
> local Postgres is on **15432**, not 5432. Both ports were already taken on
> the development machine — 3001 by a Docker/WSL relay serving an unrelated
> Next.js app, 5432/5433/5435 by other Postgres instances. The 3001 collision
> is the nastier one: Bun logs "listening" successfully while the other
> process keeps answering, so requests silently hit the wrong application.

### `apps/api/.env`
```
DATABASE_URL=postgresql://...       # Neon pooled
PORT=4000
WEB_ORIGIN=http://localhost:3000
OPENAI_API_KEY=sk-...               # server-side only, never exposed (E37)
VISION_MODEL=                       # pin at B2
TEXT_MODEL=                         # pin at B3
LLM_ENABLED=true                    # false → full E23 degradation path
LOG_LEVEL=info
```

### `apps/web/.env.local`
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Only one variable here is `NEXT_PUBLIC_`.** If an API key ever acquires that prefix, it is in the browser bundle — E37, which the brief names as its own example of a good engineering decision.

---

# Appendix 5 — Final file tree

```
emr-workspace/
├─ apps/
│  ├─ api/
│  │  ├─ drizzle/                 0000_init.sql   ← committed
│  │  ├─ src/
│  │  │  ├─ app.ts                exports app + type App (no listen)
│  │  │  ├─ index.ts              listen only
│  │  │  ├─ errors.ts
│  │  │  ├─ db/                   schema.ts · client.ts · seed.ts
│  │  │  ├─ routes/               appointments · patients · consultations
│  │  │  │                        · ai · search
│  │  │  ├─ services/             appointments · patients · consultations
│  │  │  │                        · upload · ai
│  │  │  ├─ llm/
│  │  │  │  ├─ types.ts           LlmClient interface — the seam
│  │  │  │  ├─ openai.ts · stub.ts · index.ts
│  │  │  │  └─ prompts/           transcribe.ts · structure.ts
│  │  │  ├─ verification/         normalise · grounding · numeric
│  │  │  │                        · negation · survival · index
│  │  │  │                        (+ .test.ts alongside each)
│  │  │  └─ tests/                helpers · flow · errors · idempotency
│  │  │                           · eval (L3, not in CI)
│  │  └─ drizzle.config.ts
│  └─ web/
│     ├─ app/                     layout · page · providers · error
│     │                           · not-found
│     │  ├─ patients/[id]/
│     │  └─ consultations/[id]/
│     ├─ components/              states/ · appointments/ · patient/
│     │                           · consultation/ · ui/ (shadcn)
│     └─ lib/                     api.ts (Eden) · hooks/
├─ packages/shared/src/           schema.ts · enums.ts · constants.ts
├─ notes/                         golden set — GITIGNORED
├─ EMR_PLAN.md
├─ SYNTHETIC_NOTES_TEST.md
├─ BUILD_ROADMAP.md
├─ README.md
└─ AI_USAGE.md
```

---

# Appendix 6 — Feature → step traceability

| # | Feature | Steps |
|---|---|---|
| F1 | Appointments dashboard | A6, C2 |
| F2 | Patient profile | A6, C3 |
| F3 | Consultation history | A6, C3 |
| F4 | Consultation composer | A7, C4 |
| F5 | AI note structuring | B3, B6, C6 |
| F6 | Draft review & edit | A7, C6 |
| F7 | Save to history | A7, C7 |
| F8 | Handwritten image input | B1, B2, C5 |
| F9 | Standalone Elysia API | A5 |
| F10 | DB, migrations, seed | A3, A4 |
| F11 | Validation & errors | A5, A6, A7 |
| F12 | UI states | C1 (then every C step) |
| F13 | AI audit trail | A3, B6 |
| F14 | Provenance display | C6 |
| F15 | Status transitions | A7, C7 |
| F16 | Unsaved-work guard | C8 |
| F17 | Search | A6, C9 |
| F18–F21 | Stretch | after D4, only if everything above is green |

---

# Appendix 7 — Edge case → test traceability

| # | Case | Covered in |
|---|---|---|
| E1 | Empty notes | A7, C4 |
| E2 | Very short notes | B3 (N10) |
| E3 | Very long notes | A7 |
| E4 | No medication → `[]` | B5, B3 (N06) |
| E5 | No plan → `[]` | B5 |
| E6 | Nothing clinical | B3 |
| E7 | Prompt injection | B3 (N09) |
| E8 | Code-mixed Hindi | B3 (N12) |
| E9 | Contradictory notes | B3 (N11) |
| E10 | Heavy shorthand | B2 + B3 (N02) |
| E11 | Malformed JSON | B6 |
| E12 | Extra keys | A2, B5 |
| **E13** | **Fabricated vitals** | **B4 numeric, B5 (N05)** |
| E14 | Ungrounded span | B4 grounding, B5 |
| E15 | Paraphrased span | B4 normalise, B5 |
| **E16** | **Negation inversion** | **B4 negation, B5 (N03)** |
| **E17** | **Dropped allergy** | **B4 survival, B5 (N04)** |
| E18 | Safety refusal | B2 |
| E19 | Retry also fails | B6 |
| E20 | Bad API key | A5, B7 |
| E21 | Rate limited | B7 |
| E22 | Provider timeout | B7 |
| **E23** | **Provider unavailable** | **A8, B7, D4** |
| E24 | Double-click Generate | C4 |
| E25 | Double-click Save | A7, A9, C7 |
| E26 | Navigate away unsaved | C8 |
| E27 | Two tabs | A7 (last-write-wins, documented in D1) |
| E28 | Empty states | C2, C3 |
| E29 | Save with empty AI fields | A7 |
| E30 | Edit then regenerate | C6 |
| E31 | Invalid transition | A7, A9 |
| E32 | Corrupt file | B1 |
| E33 | Blurry photo | B1, B2 |
| E34 | Not clinical notes | B2 |
| E35 | Letterhead + handwriting | B2 (N02) |
| E36 | Runaway output | B2 |
| E37 | Key in browser bundle | A5, B7, App. 4 |
| E38 | Cross-patient access | Documented as a known limitation, D1 |

**The four bolded rows are the assignment's thesis.** E13, E16, E17 and E23 are where marks are actually won — a fabricated vital, an inverted negative, a dropped allergy, and a working product when the AI is down. Everything else is supporting evidence.

---

## Start here

**Next action: step A0.** Nothing before it, nothing in parallel with it.
