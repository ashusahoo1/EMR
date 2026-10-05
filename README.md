# AI-Assisted Doctor Consultation Workspace

An EMR workspace for doctors. A doctor opens the day's appointments, starts a consultation, and either types notes or photographs a handwritten note. The AI transcribes the photo and structures the notes into a clinical record. **It never saves anything on its own.** Every AI output passes through a deterministic verification layer that flags anything not supported by the source notes, and the doctor reviews, edits, and confirms before it becomes part of the patient's record.

The whole app keeps working with the AI switched off (`LLM_ENABLED=false`).

---

## Features

| | |
|---|---|
| **Appointments dashboard** | Today's appointments in clinic time (IST), filter tabs with live counts, date switching |
| **Patient profile** | Allergy banner, consultation history (newest first), structured note with the original notes behind a disclosure |
| **Consultation composer** | Free-text notes with autosave, empty-note rejection before any model call, unsaved-work guard |
| **Photo upload** | Handwritten note → editable text, appended to what's already typed. Bad uploads are rejected before any model call |
| **AI draft and review** | Structured note generated from the notes, verification flags shown inline, doctor edits freely |
| **Save and status** | One save gives one history entry containing the doctor's version. Appointment moves `waiting → in_consultation → completed` |
| **Search** | Patients by name and consultations by note content, with the matched excerpt shown |
| **Error states** | Each error type has the right retry policy. A down API is reported as such, not as a generic error |
| **Responsive** | No horizontal scroll at 320px |

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime / monorepo | **Bun** workspaces |
| API | **ElysiaJS**, with end-to-end types to the frontend via **Eden Treaty** |
| Validation | **TypeBox**. One schema validates the API boundary, compiles to OpenAI's strict JSON Schema, and types the frontend |
| Database | **PostgreSQL 17** + **Drizzle ORM** (committed migrations) |
| Frontend | **Next.js 16**, **React 19**, **TanStack Query**, Tailwind CSS 4, shadcn/ui |
| AI | OpenAI (vision for transcription, text for structuring) behind a swappable client interface |
| Quality | Biome (lint + format), strict TypeScript, `bun test`, Playwright |

---

## Project structure

```
apps/
  api/                 Elysia API (all business logic lives here)
    src/routes/        read.ts, write.ts, ai.ts
    src/services/      business logic, DB-facing
    src/llm/           client seam: real OpenAI client, deterministic stub, prompts
    src/verification/  pure-function checks on AI output (no AI involved)
    src/db/            Drizzle schema + seed
    drizzle/           generated SQL migrations
  web/                 Next.js frontend
packages/
  shared/              TypeBox schemas shared by API and web
e2e/                   Playwright specs
scripts/               test preload, typecheck, cross-runtime format parity check
test-images/           sample uploads used by tests
```

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.4+
- Docker (for local Postgres)
- An OpenAI API key. **Optional**: without one, the app runs with AI features disabled.

### 1. Install

```bash
bun install
```

### 2. Start Postgres

```bash
docker compose up -d
```

This runs Postgres 17 on host port **15432** (not 5432, so it doesn't collide with a local install).

### 3. Configure environment

```bash
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Fill in `apps/api/.env`:

```env
DATABASE_URL=postgres://emr:emr_local_dev@localhost:15432/emr
PORT=4000
WEB_ORIGIN=http://localhost:3000

OPENAI_API_KEY=sk-...        # leave blank to run without AI
VISION_MODEL=gpt-4o-mini
TEXT_MODEL=gpt-4o-mini
LLM_ENABLED=true             # false = run with no AI at all

LOG_LEVEL=info
```

`apps/web/.env.local` only needs `NEXT_PUBLIC_API_URL=http://localhost:4000`. The OpenAI key is server-side only and never reaches the browser.

### 4. Migrate and seed

```bash
cd apps/api
bun run db:migrate
bun run db:seed
cd ../..
```

The seed creates a doctor, sample patients (some with allergies and history), and a day of appointments. All data is invented.

### 5. Run

In two terminals:

```bash
bun run dev:api    # http://localhost:4000  (API docs at /docs)
bun run dev:web    # http://localhost:3000
```

---

## How the AI pipeline works

```
Stage 0  Upload precheck   No model call. File type, size, dimensions.
Stage 1  Transcription     Photo → raw text. Shorthand ("C/O", "BD", "x3d") kept exactly as written.
            ── stops here: the text lands in an editable box for the doctor ──
Stage 3  Structuring       Notes → strict JSON matching the shared schema. Shorthand normalised here.
Stage 4  Verification      No AI. Pure functions. Flags problems, never edits the note.
            ── doctor reviews flags, edits, confirms → only then is it a record ──
```

**Verification checks** (`apps/api/src/verification/`):

| Check | Catches |
|---|---|
| Grounding | A claim that appears nowhere in the source notes |
| Negation | "no fever" becoming "fever" |
| Numeric | A dose or vital sign that isn't in the source |
| Survival | An allergy in the source that was dropped from the structured note |

The verifier is `verify(sourceText, note) → VerificationResult`, with no network, database, clock, or randomness. That's what makes it fully unit-testable, and its output is something a doctor can act on ("this line does not appear in your notes") rather than a confidence score.

**LLM client selection** (`apps/api/src/llm/index.ts`):

| Condition | Client |
|---|---|
| `LLM_ENABLED=false` | none (AI features disabled, manual workflow still works) |
| `NODE_ENV=test` | deterministic stub |
| no API key / models set | AI features unavailable |
| otherwise | real OpenAI client |

Every model call is recorded in the `ai_generations` table (prompt version, model id, output), with one automatic retry on invalid output.

---

## Design decisions

1. **Transcription doesn't auto-trigger structuring.** Reading the paper and interpreting it are different steps with different errors. Stopping at editable text lets the doctor fix a misread "15mg" before it becomes a confident-looking structured record.
2. **AI output is never saved without confirmation.** `consultations` keeps `rawNotes`, `aiNote`, and `confirmedNote` as separate columns, so the record shows both what the AI proposed and what the doctor confirmed.
3. **Flag, never silently drop.** Verification never changes the note. Every finding is a flag the doctor decides on.
4. **Uploaded images are not stored.** They're processed in memory and discarded. Storing patient images would need encryption, retention, and access-control guarantees that are out of scope.
5. **Graceful degradation.** With the AI off or failing, the doctor can still write and save consultations. The test suite runs on the stub, so this path is exercised on every run.
6. **Client-side tab filtering, server-side date filtering.** A day's appointments are already in memory, so filtering them needs no request. A different date is a different dataset, so it does.

---

## Testing

```bash
bun test                            # unit + integration (needs Postgres running)
bunx playwright install chromium    # first time only
bun run test:e2e                    # browser end-to-end
bun run lint                        # Biome
bun run typecheck                   # tsc + cross-runtime date-format parity
```

- **`bun test`**: 445 tests across 28 files covering API routes, services, verification, schema contracts, and formatters.
- **Playwright**: 45 tests across 5 specs (dashboard, consultation, upload, search and error states, responsive at 320px). The suite starts its own API and web servers on ports 4100/3150, so it doesn't interfere with a running dev setup.

Both suites use the stub LLM, so they need no API key, cost nothing, and are deterministic.

---

## Known limitations

- **No authentication.** Patient data isn't isolated per user. This build is single-doctor.
- **Negation checking is a word-list heuristic**, not clinical NLP.
- **Not deployed.** It runs locally only.

---

## Further reading

- [`EMR_PLAN.md`](EMR_PLAN.md): research, competitor analysis, and product decisions
- [`BUILD_ROADMAP.md`](BUILD_ROADMAP.md): build order and per-step done criteria
- [`MANUAL_TEST.md`](MANUAL_TEST.md): by-hand test plan
- [`SYNTHETIC_NOTES_TEST.md`](SYNTHETIC_NOTES_TEST.md): golden set of synthetic consultation notes
