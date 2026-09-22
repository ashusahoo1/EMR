# AI-Assisted Doctor Consultation Workspace — Implementation Research

---

## 1. Competitor Analysis — HealthPlix

Scoped deliberately to the parts of the product that overlap with what we are building. Everything else is noted only to show awareness.

### 1.1 What their AI consultation flow actually does

HealthPlix's AI consultation product (HALO) runs speech-to-text over the live consultation, then passes that transcript to their own models, which structure it into a clinical record covering:

```
vitals · complaints · diagnosis · medication · advice · treatment plan
```

**Why this matters to us:** that field list is a production version of the exact schema the assignment asks for. The assignment's target JSON —

```
chiefComplaint · symptoms · relevantHistory ·
medicationsMentioned · doctorPlan · missingInformation
```

— is a deliberately trimmed variant of the same idea.

**Decision:** implement the assignment's schema exactly as specified. Do not "improve" it by adding `diagnosis` or `vitals` fields. Adding a `diagnosis` field actively invites the model to infer a diagnosis the doctor never stated, which is the specific failure the brief is testing for.

### 1.2 The colloquial → clinical mapping problem

HealthPlix give a concrete example from real consultations: a doctor may say _"your sugar is on the higher side"_ to reassure the patient, while intending to record **Type 2 Diabetes Mellitus** in the prescription. Their system is trained to capture what was said while interpreting the clinical meaning behind it.

This creates the central tension of our prompt design, and it fails in **both** directions:

| Failure mode     | Symptom                                     | Result                                |
| ---------------- | ------------------------------------------- | ------------------------------------- |
| Too literal      | Output is just reformatted rough notes      | Feature is useless, adds no value     |
| Too interpretive | Model infers diagnoses/values nobody stated | Violates the brief's core requirement |

**Design rule to carry into the prompt: normalise vocabulary, never infer clinical facts.**

| Input                      | Acceptable output                         | Reason                                      |
| -------------------------- | ----------------------------------------- | ------------------------------------------- |
| "fever since 3 days"       | "Fever for 3 days"                        | Tidying phrasing only                       |
| "allergic to penicillin"   | `relevantHistory: ["Penicillin allergy"]` | Restating a stated fact                     |
| "no breathing difficulty"  | "No breathing difficulty reported"        | Preserves the negative as stated            |
| "no breathing difficulty"  | ~~"Respiratory distress ruled out"~~      | Clinical conclusion the doctor did not make |
| "sugar on the higher side" | ~~"Type 2 Diabetes Mellitus"~~            | Diagnosis the doctor did not state          |

Note the divergence from HealthPlix: they _can_ make that last leap because they have models trained on years of their own clinical data plus doctor-specific prescribing history. We cannot, and should not pretend to. This is worth stating explicitly in the README as a scope decision.

### 1.3 The guardrail precedent worth stealing

In June 2022 HealthPlix shipped a **drug-drug interaction nudge** — proactively surfacing potential interactions between incompatible drugs at the point of prescribing.

The important word is _nudge_. It is advisory, not blocking.

**Apply this directly to our `missingInformation` field.** Do not block saving because temperature was never recorded. Surface it as a visible, dismissible prompt above the save action. Blocking a doctor mid-clinic is how EMRs get abandoned, and the brief's own UX criteria reward "sensible defaults" over enforcement.

### 1.4 One external data point worth carrying in

From the wider ambient-scribe category (Abridge, Nabla, DAX, Suki and others), independent comparisons put hallucination rates at roughly **7% on average**, with **physical examination sections the most vulnerable** part of the generated note.

This is directly useful:

1. It justifies building a verification layer at all, rather than trusting the model.
2. Vitals and physical-exam findings being the weakest area maps exactly onto the brief's own example — the model inventing a blood pressure value that was never mentioned.

A widely-repeated design rule in that category is to **ground every clinical claim in a span of the source text and flag anything that cannot be grounded** — the reasoning being that a note with a visible gap is safer than a note containing a plausible invented dose.

---

## 2. Tech Stack

### 2.1 The stack at a glance

| Layer          | Choice                                                                                                         | Why                                                                                                 | Locked by             |
| -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Runtime        | **Bun**                                                                                                        | Elysia is Bun-first; not a free choice                                                              | Brief mandates Elysia |
| Backend        | **ElysiaJS + TypeScript**                                                                                      | Mandated. Must be a standalone service, not Next.js route handlers                                  | Brief                 |
| Frontend       | **Next.js (App Router) + TypeScript**                                                                          | Mandated                                                                                            | Brief                 |
| API client     | **Eden Treaty**                                                                                                | End-to-end types with no codegen; also enables in-process API tests                                 | Us                    |
| UI             | **Tailwind + shadcn/ui**                                                                                       | Brief names both as acceptable; shadcn gives accessible primitives without a design system to learn | Us                    |
| Data fetching  | **TanStack Query**                                                                                             | Loading / error / empty states are explicitly graded; this gives them for free                      | Us                    |
| Database       | **PostgreSQL** (Neon or local Docker)                                                                          | Survives ephemeral container filesystems, unlike file-based SQLite                                  | Us                    |
| ORM            | **Drizzle + drizzle-kit**                                                                                      | SQL-shaped, tiny, no binary, clean Bun story, real migration files to submit                        | Us                    |
| API validation | **TypeBox** (Elysia's built-in `t`)                                                                            | Native to Elysia, zero extra dependency                                                             | Us                    |
| LLM            | **OpenAI SDK** with strict structured outputs                                                                  | Credits available; single provider keeps it simple                                                  | Us                    |
| Testing        | **`bun:test`**                                                                                                 | Native, zero config, pairs with Eden's in-process test pattern                                      | Us                    |
| Lint / format  | **Biome**                                                                                                      | One tool, one config, fast                                                                          | Us                    |
| Monorepo       | **Bun workspaces**                                                                                             | Needed so the frontend can import the backend's type for Eden                                       | Us                    |
| Hosting        | Backend on a **Bun-capable container host** (Railway / Fly / Render) · Frontend on **Vercel** · DB on **Neon** | Bun does not run on Vercel's serverless functions — this is the single biggest deployment gotcha    | Constraint            |

### 2.2 Repo layout

```
apps/
  api/     Elysia backend — routes, services, llm, db
  web/     Next.js frontend
packages/
  shared/  types and constants used by both
```

Bun workspaces. The frontend imports `type App` from `apps/api` for Eden Treaty. This is the one setup step Eden requires, and it must be working before much else is built.

### 2.3 Decisions that need explaining

**Bun changes deployment.** Elysia runs on Bun, and Vercel's serverless functions do not. The frontend can still go on Vercel; the API needs a container host that runs Bun. Worth discovering on day one, not on submission day.

**Postgres over SQLite.** SQLite is simpler locally, but most container hosts have ephemeral filesystems, so the database disappears on redeploy — including mid-demo. Neon's free tier removes the problem. If he'd rather stay file-based, Turso is the version of SQLite that survives deployment.

**Drizzle over Prisma.** Both are fine in 2026 — Prisma 7 replaced the Rust query engine with a TypeScript/WASM implementation, so the old binary and bundle-size complaints are largely gone. Drizzle still wins here on being SQL-shaped, dependency-light, and having the smoother Bun story. Prisma's advantage is Prisma Studio and a gentler API. **Either is defensible; pick one and don't relitigate it.**

**TypeBox at the API boundary, and possibly for the LLM too.** Elysia ships TypeBox as `t` for request/response validation, so it is free. The neat part: TypeBox _is_ JSON Schema, so the same schema can drive OpenAI's strict structured-output mode without a second validation library. If that proves fiddly, fall back to Zod for the LLM layer only and accept two validators — a small, explainable cost.

**A thin `llm/` module, not a framework.** Two functions — `transcribeImage()` and `structureNotes()` — wrapping the OpenAI SDK. The reason is **testability**, not provider portability: without this seam every pipeline test has to mock the OpenAI SDK itself. It also answers "what if the provider is down during your demo."

**Do not persist the uploaded image (F17).** Process it in memory, store only the transcript. Persisting it means object storage, lifecycle policy, and a much bigger data-protection footprint. Note it in the README as a deliberate scope decision.

### 2.4 Considered and rejected

This table is the raw material for `AI_USAGE.md` section 4 — write it down as decisions are made, not afterwards.

| Option                                     | Verdict                | Reasoning                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LangChain / LangGraph**                  | Rejected               | LangGraph earns its place with durable state, agent loops and tool orchestration. We have two independent model calls with an HTTP boundary between them — the "human in the loop" is a separate request, and the state lives in Postgres. It also puts an abstraction between the developer and the prompt, which is exactly what the interview will probe |
| **Vercel AI SDK**                          | Considered, not needed | Genuinely good fit (`generateObject` + Zod, `streamObject` for F18, provider swap by env var). Dropped only because a single provider is already settled. **Reconsider if F18 streaming gets built**                                                                                                                                                        |
| **Next.js API routes for backend logic**   | Rejected               | The brief forbids it explicitly                                                                                                                                                                                                                                                                                                                             |
| **Prisma**                                 | Rejected (narrowly)    | See above — a close call, not a strong one                                                                                                                                                                                                                                                                                                                  |
| **Playwright / E2E**                       | Rejected               | Covered by in-process Eden Treaty integration tests at a fraction of the cost. **State this tradeoff in the README** — a stated tradeoff reads as judgement, silence reads as an omission                                                                                                                                                                   |
| **Frontend component tests**               | Rejected               | Low marginal value against the brief's weighting                                                                                                                                                                                                                                                                                                            |
| **An LLM as the verification checker**     | Rejected               | Non-deterministic, costs a call, can hallucinate its own approval, untestable. See §4.6                                                                                                                                                                                                                                                                     |
| **Cross-engine OCR disagreement flagging** | Deferred               | Good idea, real cost. `[illegible]` gets most of the value. See §4.3                                                                                                                                                                                                                                                                                        |

### 2.5 Testing shape

No E2E, no component tests. Three layers only:

| Layer                   | Tool                          | What it covers                                                                                                                                           | Runs in CI            |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Verification unit tests | `bun:test`                    | Pure functions over hand-written fixtures — invented BP, inverted negation, dropped allergy, ungrounded span. **The highest-value tests in the project** | Yes                   |
| API integration tests   | `bun:test` + Eden Treaty      | The full flow — consultation → structure → edit → save → history — in-process, LLM stubbed                                                               | Yes                   |
| Golden-set eval         | `bun:test`, tagged separately | Hits the real API against known-good notes. Non-deterministic, costs money                                                                               | **No** — run manually |

Eden Treaty is what makes layer 2 cheap: passing the Elysia instance directly to the client calls `app.handle` with no network request and no server to start, so the whole flow runs in milliseconds with no ports and no teardown flakiness. With E2E dropped, this layer is what proves the brief's 25% end-to-end criterion.

---

## 3. Feature Map

Top-level features only. Each of these gets a deep dive later; implementation details, libraries and sub-components are deliberately not listed here.

**Priority key**

- **P0** — required by the brief. The submission fails without it.
- **P1** — small additions with high scoring value relative to effort. Build once P0 is stable.
- **P2** — stretch. Build only if P0 and P1 are complete, seeded, deployed and documented.

### 3.1 Core product features

| #   | Feature                      | One-line description                                                                                      | Priority | In brief?                               |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------- |
| F1  | Appointments dashboard       | Today's appointment list with time, patient, reason and status; rows are clickable                        | P0       | Yes                                     |
| F2  | Patient profile              | Demographics, allergies and existing conditions for a single patient                                      | P0       | Yes                                     |
| F3  | Consultation history         | Previous consultations for that patient, most recent first                                                | P0       | Yes                                     |
| F4  | Consultation composer        | Free-text entry surface for the doctor's rough, unstructured notes                                        | P0       | Yes                                     |
| F5  | AI note structuring          | Converts rough notes into the fixed structured schema                                                     | P0       | Yes                                     |
| F6  | Draft review & edit          | Doctor reviews, corrects and amends every AI-generated field before it counts                             | P0       | Yes                                     |
| F7  | Save to history              | Persists the doctor-confirmed consultation so it appears in F3                                            | P0       | Yes                                     |
| F8  | Handwritten note image input | Photo of paper notes — or an image exported from a drawing surface — transcribed into F4 as editable text | P0       | No — **our product decision**, see §3.5 |

### 3.2 Platform features

| #   | Feature                     | One-line description                                                                         | Priority | In brief?                 |
| --- | --------------------------- | -------------------------------------------------------------------------------------------- | -------- | ------------------------- |
| F9  | Standalone ElysiaJS API     | All business logic lives in a separate backend service, not Next.js route handlers           | P0       | Yes — explicitly required |
| F10 | Database, migrations & seed | Real database with versioned migrations and seed data that makes the app usable on first run | P0       | Yes                       |
| F11 | Validation & error handling | Request/response validation at the API boundary with a consistent error contract             | P0       | Yes                       |
| F12 | UI state handling           | Loading, error and empty states across every view                                            | P0       | Yes                       |

### 3.3 Small additions — high value, low cost

| #   | Feature                        | One-line description                                                                  | Priority | In brief?                                                |
| --- | ------------------------------ | ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| F13 | AI audit trail                 | Stores the original notes, the raw AI output and the doctor-edited version separately | P1       | Bonus — but treat as core; it is what makes F13 possible |
| F14 | Provenance display             | Visibly distinguishes AI-generated content from doctor-confirmed content              | P1       | Yes — listed under UX criteria                           |
| F15 | Appointment status transitions | Move an appointment through Waiting → In Consultation → Completed                     | P1       | Bonus                                                    |
| F16 | Unsaved-work protection        | Prevents accidental loss of notes or an unsaved draft on navigate-away                | P1       | Yes — listed under UX criteria                           |
| F17 | Search                         | Find patients or consultations                                                        | P1       | Bonus                                                    |

### 3.4 Stretch

| #   | Feature                    | One-line description                                                                                     | Priority | In brief?                                    |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| F18 | Streaming AI response      | Stream the structured note into the UI as it generates                                                   | P2       | Bonus                                        |
| F19 | AI patient history summary | Generates a summary across a patient's previous consultations                                            | P2       | Bonus                                        |
| F20 | In-browser whiteboard      | Draw notes on a canvas and export to an image — **reuses F17's pipeline unchanged**, no new backend work | P2       | No — convenience wrapper over F17            |
| F21 | Doctor login               | Minimal authentication for a single doctor user                                                          | P2       | Bonus — brief says do not build complex auth |

### 3.5 Notes on the map

- **Why F17 is core, and why it is a photo (our decision, not the brief's).** Handwritten notes remain the dominant form of record-keeping in Indian outpatient practice — doctors write on a pad, not a screen. Almost no clinician owns a pen tablet, so a drawing surface alone would serve a user who does not exist. A phone photo of paper is the input doctors actually produce, so that is the primary path. Because it is not in the brief, the README should state it as a deliberate product choice rather than scope creep.
- **The whiteboard (F20) rides on the same pipeline.** A canvas drawing exports as an image and hits the identical upload endpoint — and it is the _easier_ case: clean digital ink, no lighting, blur, skew or page curl. So supporting drawn input costs a frontend canvas and zero backend work. It stays P2 purely because the photo path serves the real user and the canvas serves the demo.
- **F12 should be built at P0 time even though it is listed P1.** Adding the audit columns to the schema on day one is nearly free; retrofitting them later is not, and F13 depends on them.
- **F21 is last for a reason.** The brief explicitly says not to spend time on complex authentication, so effort here is close to unrewarded.
- Testing is a workstream, not a feature — covered in its own section.

---

## 4. The AI Pipeline

The single most important design decision: **every stage does exactly one thing, and there is a human checkpoint between the AI stages.**

### 4.1 Stages at a glance

| Stage | Name              | Who does it  | Input → Output                 | Why it exists                                   |
| ----- | ----------------- | ------------ | ------------------------------ | ----------------------------------------------- |
| 0     | Upload & precheck | Code         | Image file → validated image   | Fail cheap before spending a model call         |
| 1     | Transcription     | VLM          | Image → plain text             | Read the handwriting, nothing more              |
| 2     | Human checkpoint  | Doctor       | Machine text → corrected text  | Catch misreads before they become "facts"       |
| 3     | Structuring       | Text LLM     | Text → schema-constrained JSON | Turn prose into fields                          |
| 4     | Verification      | Code (no AI) | Text + JSON → verdict          | Prove every field traces back to the notes      |
| 5     | Review            | Doctor       | Draft JSON → confirmed JSON    | Nothing is clinical until a human says so       |
| 6     | Save & audit      | Code         | Confirmed JSON → DB rows       | Record what AI said vs what the doctor accepted |

Two rules that hold across the whole pipeline:

1. **Stages 1 and 3 are separate model calls.** Never one multimodal call that takes a photo and returns clinical JSON. That collapses the human checkpoint, makes failures unattributable, and makes stage 3 untestable without image fixtures.
2. **Stage 2 is where both input paths merge.** A doctor typing notes by hand enters the pipeline at stage 2. Stages 0–1 are purely additive and can be removed without touching anything downstream.

---

### 4.2 Stage 0 — Upload & precheck

**Goal:** reject bad input before it costs a model call.

**What to do**

- Client-side file type and size validation; compress/resize before upload
- Reject images below a resolution threshold, or obviously blurred
- Enforce a server-side size cap independently — never trust the client
- Return a specific error, not a generic failure

**Why it matters:** a blurry photo that reaches stage 1 produces confident nonsense. A blurry photo caught at stage 0 produces "this image is too blurry to read, try again in better light." One is a bug report, the other is a good product.

---

### 4.3 Stage 1 — Transcription (VLM)

**Goal:** convert handwriting to text, verbatim. Nothing else.

**Why a VLM and not a classical OCR engine:** traditional engines were built for separated printed characters. Tesseract sits around 12.5% CER on handwriting and 40–60% accuracy on cursive; PaddleOCR, the strongest classical engine, reaches only ~72.8% on handwriting. Frontier VLMs hit 93–95% on handwriting benchmarks. For handwriting specifically, a VLM is not a shortcut — it is the accurate option.

**The prompt is a transcription prompt, not an assistant prompt**

| Instruction                             | Reason                                          |
| --------------------------------------- | ----------------------------------------------- |
| Transcribe exactly as written           | Prevents silent "helpful" rewriting             |
| Do not correct spelling or grammar      | A misspelling may be a real clue for the doctor |
| Do not expand abbreviations             | `PCM` stays `PCM`, not "Paracetamol"            |
| Do not infer what was probably meant    | That is stage 3's job, on corrected text        |
| Mark unreadable text as `[illegible]`   | The single most important rule — see below      |
| Preserve line breaks and list structure | Layout carries meaning in clinical notes        |

**Temperature 0.** Transcription has one correct answer.

**The `[illegible]` rule**

Handwriting is where models hallucinate most confidently. A fabrication here is uniquely dangerous because it is invisible to every downstream check — once a wrong drug name is in the text, stage 4 will verify it as perfectly grounded, because by then the fabrication _is_ the source.

```
Bad:   "... took amoxicillin yesterday"      ← guessed from an unreadable scrawl
Good:  "... took [illegible] yesterday"      ← doctor's eye goes straight to it
```

**Other guardrails at this stage**

- Refuse non-notes: if the image is not handwritten clinical notes, say so rather than transcribing a screenshot
- Runaway-output cap: output length wildly disproportionate to the image means the model is generating, not reading — treat as failure

**Optional: cross-engine disagreement flagging**

Run a cheap classical engine over the same image and mark spans where the two disagree, so the doctor's attention goes to the risky words. The classical engine does not need to be accurate — disagreement alone is a free confidence signal. **Recommendation: document as considered, defer the build.** `[illegible]` plus self-reported confidence gets most of the value for a fraction of the work.

---

### 4.4 Stage 2 — Human checkpoint

**Goal:** the doctor corrects the machine before anything treats it as fact.

**What to do**

- Extracted text lands in the normal, fully editable notes textarea
- Visibly marked as machine-transcribed until edited
- **Never auto-trigger stage 3.** The doctor presses Generate
- `[illegible]` markers visually highlighted so they are obvious

**Why this is non-negotiable:** without it you stack two error sources and the doctor cannot tell whether a wrong field came from a misread word or a bad structuring call. With it, each stage is independently debuggable — and the doctor stays in control, which is the entire product thesis.

---

### 4.5 Stage 3 — Structuring (text LLM)

**Goal:** turn prose into the fixed schema without adding anything.

**Closed schema, with source spans**

Every item carries the exact substring of the notes it came from. This is what makes stage 4 possible.

```json
{
  "chiefComplaint": { "text": "Fever", "sourceSpan": "fever since 3 days" },
  "symptoms": [
    { "text": "Fever for 3 days", "sourceSpan": "fever since 3 days" },
    { "text": "Mild cough", "sourceSpan": "mild cough" }
  ],
  "relevantHistory": [
    { "text": "Penicillin allergy", "sourceSpan": "allergic to penicillin" }
  ],
  "missingInformation": ["Temperature was not recorded"]
}
```

`sourceSpan` is never shown to the doctor. It is machinery for verification, and later for provenance highlighting.

**Ask for the substring, never character offsets.** `{"start": 12, "end": 28}` looks cleaner and fails in practice — models are unreliable at counting characters, so you reject valid output over off-by-several errors. Let the model copy text; let `indexOf` find it.

**Schema-level guardrails (cheaper than prompting)**

- `additionalProperties: false` — the model cannot invent a `bloodPressure` key that does not exist
- **No slot, no temptation.** We deliberately do not add `vitals` or `diagnosis` fields. The cheapest hallucination guardrail is not giving the model a box to fill
- Use the provider's native constrained-decoding mode (OpenAI strict / Gemini response schema / Anthropic tool use) **and** validate with Zod server-side. Provider enforcement guarantees shape, not truth

**Prompt-level guardrails**

| Rule                                    | Example                                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty arrays are a correct answer       | `"medicationsMentioned": []` is good output, not a failure. Models pad to look complete — say this explicitly                                 |
| Normalise vocabulary, never infer facts | `"fever since 3 days"` → `"Fever for 3 days"` ✅ · `"sugar on the higher side"` → `"Type 2 Diabetes Mellitus"` ❌                             |
| Preserve stated negatives               | `"no breathing difficulty"` must survive as a negative, not be dropped. Omission is a hallucination too                                       |
| Reformat, do not advise                 | No suggested treatments, doses, or diagnoses. The model is a scribe, not a consultant                                                         |
| Treat notes as data, never instructions | Delimit the notes clearly. Assume someone will type "ignore previous instructions" into the textarea — because at the interview, someone will |

**Temperature 0 or near it.** Determinism makes the eval set meaningful.

---

### 4.6 Stage 4 — Verification (code, no AI)

**Goal:** mechanically prove that every field traces back to the doctor's notes.

**This stage uses no model.** Checking AI output with more AI is a weak answer: it is non-deterministic, costs another call, can hallucinate its own approval, is hard to unit-test, and raises the obvious question of who checks the checker. String operations are deterministic, free, instant, and explainable to a doctor — _"this line does not appear in your notes."_

**The checks, in order**

**1. Parse + schema validation.** Deserialises and matches the schema. Failures here are hard failures.

**2. Span grounding.** Does each `sourceSpan` actually occur in the source text?

Normalise both sides before comparing — lowercase, collapse whitespace, normalise smart quotes and dashes — or false failures will bury the real ones. Try raw match first, then normalised.

```
notes:      "patient has fever since 3 days"
sourceSpan: "fever since 3 days"     → found ✅
sourceSpan: "BP 130/80"              → not found ❌ fabricated
```

**3. Numeric containment.** The blood-pressure test, mechanised. Every number in the output must appear in the input.

```
notes:  "fever since 3 days"
output: "Fever for 3 days"   → 3 present in input ✅
output: "BP 130/80"          → 130, 80 absent from input ❌
```

Edge cases to allow for: digits vs words ("3" vs "three"), and Indian clinical shorthand like `x3d`. Keep the rule strict but let borderline cases **flag rather than fail** — a flag costs a glance, a false rejection costs the feature.

**4. Negation preservation.** The nastiest failure, because it is _grounded_ and still wrong.

```
notes:      "no breathing difficulty"
output:     { "text": "Breathing difficulty",
              "sourceSpan": "no breathing difficulty" }
```

The span is real. Grounding passes. The meaning is inverted.

Check: if the span contains a negation token (`no`, `not`, `denies`, `without`, `nil`, `absent`, `ruled out`) but the output text does not preserve a negative, flag it.

**Be honest about the limits.** A word-list check misses distant negation ("denies any respiratory complaints") and double negatives. It is not clinical NLP and should not be presented as such — it catches the common dangerous case cheaply and flags rather than deletes. The sensible escalation, worth documenting but not building, is to run a model _only_ on items this check marks ambiguous, so AI becomes the fallback for a handful of edge cases rather than the primary gate.

**5. Allergy / medication survival check.** If the notes mention an allergy, it must appear in `relevantHistory`.

This is the **reverse-direction** check, and the one people never build. Dropping "allergic to penicillin" is arguably worse than inventing a BP — and grounding checks cannot catch it by definition, since they only validate what is present, never what went missing.

**Severity tiers**

| Tier       | Trigger                                | Action                              |
| ---------- | -------------------------------------- | ----------------------------------- |
| Hard fail  | Unparseable, schema-invalid            | Retry once, then error state        |
| Repairable | Ungrounded item, numeric violation     | Retry once with the errors fed back |
| Soft flag  | Negation suspicion, borderline numeric | Show to doctor marked "unverified"  |
| Pass       | All checks clean                       | Show normally                       |

**One retry, not a loop.** Feed validation failures back as a correction message, re-run, re-validate. If it fails again, show an error state and let the doctor write the note manually. Unbounded retries burn cost and latency and rarely converge.

**Flag, never silently drop.** Deleting data behind a doctor's back is worse than showing them something suspect.

**The testing payoff:** verification is a pure function — `(sourceText, aiOutput) → VerificationResult`. No network, no API key, no mocking, no flakiness. Hallucination handling can therefore be unit-tested exhaustively with hand-written fixtures (invented BP, inverted negation, dropped allergy, paraphrased span) in milliseconds. This is the answer to "how do you test non-deterministic AI output": **you do not test the model, you test the layer that constrains it.**

---

### 4.7 Stage 5 — Doctor review

**Goal:** nothing becomes clinical record until a human says so.

**What to do**

- Every field editable — no exceptions, no read-only AI output
- Explicit confirm action; AI output is never saved as final by default
- Flagged items visibly marked "unverified", with the reason
- `missingInformation` rendered as a **nudge above the save action, never a blocker** — the HealthPlix drug-interaction-nudge pattern. Do not prevent saving because temperature was not recorded
- Unsaved-changes guard on navigate-away
- Clear visual distinction between AI-generated and doctor-confirmed content

---

### 4.8 Stage 6 — Save & audit

**Goal:** make it possible to answer "what did the AI say, and what did the doctor actually accept?"

**What to store**

- Original notes (as entered or corrected at stage 2)
- Raw AI output, unmodified
- Doctor-edited final version
- **Model name and prompt version** — one extra column, and without it the audit trail is uninterpretable six months later
- Verification result and any flags raised
- Explicit draft vs confirmed state on the consultation

If stage 1 ran, the chain extends backwards: original image → transcribed text → doctor-corrected text → AI structured output → doctor-confirmed output.

---

### 4.10 The structured output contract

**Do not redesign this schema.** It is fixed by the brief, and the restraint is the point — every field added is a box the model feels obliged to fill.

#### Scope note

Three things get conflated and should not be:

| Thing                 | What it is                          | In scope?                                  |
| --------------------- | ----------------------------------- | ------------------------------------------ |
| The rough note        | What the doctor scribbles or types  | **Yes** — the input                        |
| The structured output | The JSON below                      | **Yes** — the deliverable                  |
| A prescription (Rx)   | A formal, issuable medical document | **No** — brief excludes real prescriptions |

Handwritten input may _look_ like a prescription pad, because that is how Indian OPD notes are written. What comes out is a consultation record, not a prescription.

#### The schema

| Field                  | Shape                 | Notes                                           |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `chiefComplaint`       | single item           | The one-line reason for the visit               |
| `symptoms`             | list                  | Including stated negatives                      |
| `relevantHistory`      | list                  | Allergies, existing conditions, prior events    |
| `medicationsMentioned` | list                  | **Mentioned**, not prescribed — see naming note |
| `doctorPlan`           | list                  | Advice, instructions, follow-up conditions      |
| `missingInformation`   | list of plain strings | Absences — no source span, by definition        |

Every item except `missingInformation` carries a `sourceSpan` (see §4.5).

```json
{
  "chiefComplaint": { "text": "Fever", "sourceSpan": "fever since 3 days" },
  "symptoms": [
    { "text": "Fever for 3 days", "sourceSpan": "fever since 3 days" },
    { "text": "Mild cough", "sourceSpan": "mild cough" },
    {
      "text": "No breathing difficulty",
      "sourceSpan": "no breathing difficulty"
    }
  ],
  "relevantHistory": [
    { "text": "Penicillin allergy", "sourceSpan": "allergic to penicillin" }
  ],
  "medicationsMentioned": [
    { "text": "Paracetamol", "sourceSpan": "took paracetamol yesterday" }
  ],
  "doctorPlan": [
    { "text": "Hydration", "sourceSpan": "advised hydration" },
    { "text": "Rest", "sourceSpan": "rest" },
    {
      "text": "Return if symptoms worsen",
      "sourceSpan": "return if symptoms worsen"
    }
  ],
  "missingInformation": [
    "Temperature was not recorded",
    "Duration of cough not specified"
  ]
}
```

#### Fields deliberately NOT included

| Rejected field                             | Why                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `vitals` / `bloodPressure` / `temperature` | The brief's own hallucination example. No slot, no temptation            |
| `diagnosis`                                | Invites the model to infer a clinical conclusion the doctor never stated |
| `dosage` / `frequency`                     | Turns the output into a prescription, which is out of scope              |
| `icdCode` / `severity`                     | Requires clinical judgement we are not equipped to make                  |

**Naming matters:** `medicationsMentioned`, not `medications` or `prescription`. The weaker verb records what was said rather than issuing anything — and it keeps the model in scribe mode.

#### Input format to expect

A typical Indian OPD note mixes printed letterhead with a handwritten body:

```
Patient name / age / sex / date
C/O   fever x3d, mild cough
      no breathlessness
H/O   allergic to penicillin
O/E   afebrile, chest clear
Rx    Tab PCM 650 BD x3d
Advice — hydration, rest
        review if worse / SOS
```

Common shorthand: `C/O` complains of · `H/O` history of · `K/C/O` known case of · `O/E` on examination · `Dx` diagnosis · `Rx` treatment · `Tab`/`Cap`/`Syp` · `OD`/`BD`/`TDS`/`QID`/`HS`/`SOS` frequency · `x3d` for three days · `PCM` paracetamol · `NAD` no abnormality detected.

Three consequences for the prompts:

1. **Stage 1 must not expand shorthand.** `PCM` stays `PCM`. Expansion is interpretation, and that belongs to the doctor at stage 2.
2. **Stage 3 may normalise it.** `x3d` → "for 3 days" is vocabulary normalisation, not clinical inference — a clean worked example for the prompt.
3. **Mixed printed + handwritten is the norm.** Stage 1 should transcribe the handwritten body and skip letterhead boilerplate.

---

### 4.11 Cross-cutting guardrails

**Graceful degradation — the most important one.** If the LLM provider is down, over quota, or slow, the doctor must still be able to write free-text notes and save the consultation. **The AI is an accelerant, not a dependency.**

This is the easiest guardrail to skip because it only surfaces when something breaks — which, during a live demo on conference wifi, it will. It is also a strong answer to "what would you do differently in production."

Plus the unglamorous ones:

- API key server-side only, never exposed to the browser — the brief hands this over as its own example of a good engineering decision
- Request timeouts on every model call
- Rate limiting on the AI endpoints
- Token and cost caps per request
- Structured logging of every AI call: latency, tokens, verification outcome

---

## 5. Testing Architecture & Edge Cases

### 5.1 The testing philosophy in one line

**You cannot test the model. You test the layer that constrains it.**

Stage 4 verification (§4.6) is a pure function — `(sourceText, aiOutput) → VerificationResult` — with no network, no API key, no mocking and no flakiness. That makes hallucination handling exhaustively testable with hand-written fixtures. Everything below is built around that fact.

### 5.2 The three layers

| Layer                     | Runner                        | Scope                                       | LLM                        | In CI           |
| ------------------------- | ----------------------------- | ------------------------------------------- | -------------------------- | --------------- |
| **L1 Verification units** | `bun:test`                    | Pure functions over crafted fixtures        | Never called               | Yes             |
| **L2 API integration**    | `bun:test` + Eden Treaty      | Full flow in-process, no server, no network | Stubbed at the `llm/` seam | Yes             |
| **L3 Golden-set eval**    | `bun:test`, tagged separately | Real prompts against real API               | Real calls                 | **No** — manual |

**Why the `llm/` seam matters:** L2 stubs two functions, not the OpenAI SDK. Without that seam every integration test has to mock a third-party library's internals, which is brittle and unreadable.

**Why L3 is out of CI:** it costs money, it is non-deterministic, and a red build caused by model drift trains people to ignore red builds. Run it before submission and when the prompt changes; record the results in the README.

**Scoring alignment:** with E2E and component tests deliberately dropped (§2.4), **L2 is what proves the brief's 25% end-to-end criterion.** It must walk the whole path — appointment → patient → consultation → structure → edit → save → appears in history — not just hit endpoints individually.

### 5.3 Edge cases — doctor's input

The notes textarea is untrusted, free-form input from a hurried human.

| #   | Case                                                            | Expected behaviour                                                                                |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| E1  | Empty or whitespace-only notes                                  | Generate disabled; API rejects with 422 if called directly                                        |
| E2  | Very short notes ("fever")                                      | Works. `chiefComplaint` populated, other arrays empty — **not** padded                            |
| E3  | Very long notes (10k+ chars)                                    | Length cap with a clear message, enforced server-side too                                         |
| E4  | No medication mentioned                                         | `medicationsMentioned: []`. Empty array is a **correct answer**, never fabricated                 |
| E5  | No plan mentioned                                               | `doctorPlan: []`                                                                                  |
| E6  | Nothing clinical ("asdfgh")                                     | Degrades gracefully — mostly empty output plus `missingInformation`, not an invented consultation |
| E7  | Prompt injection in notes ("ignore previous instructions and…") | Treated as data. Output unaffected. **Assume this will be tested at the interview**               |
| E8  | Hindi / transliterated / code-mixed notes                       | Either handled or failed cleanly — never silently mistranslated                                   |
| E9  | Contradictory notes ("fever 3 days… no fever today")            | Both preserved as stated; the model does not arbitrate                                            |
| E10 | Heavy shorthand (`C/O`, `x3d`, `BD`, `PCM`)                     | Normalised at stage 3 only; never expanded at stage 1 (§4.10)                                     |

### 5.4 Edge cases — AI output failure

These are the L1 fixtures. **Every one should be a named test.**

| #   | Case                                                                           | Expected behaviour                                                                                    |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| E11 | Unparseable / malformed / truncated JSON                                       | Hard fail → one retry → error state. Never saved as partial data                                      |
| E12 | Schema-valid but extra keys                                                    | Rejected by `additionalProperties: false`                                                             |
| E13 | **Fabricated vitals** — output contains "BP 130/80", notes never mention it    | Numeric containment check fails → repairable → flagged. **The brief's headline case**                 |
| E14 | **Ungrounded span** — `sourceSpan` text absent from notes                      | Grounding check fails → item flagged as unverified                                                    |
| E15 | **Paraphrased span** — model rewrites instead of copying verbatim              | Normalised match attempted; if still absent, flagged rather than silently accepted                    |
| E16 | **Negation inversion** — notes "no cough", output "Cough" with span "no cough" | Span is real and grounding passes — only the negation check catches this. **The most dangerous case** |
| E17 | **Dropped allergy** — notes mention penicillin allergy, output omits it        | Reverse-direction survival check fires. Grounding cannot catch omissions by definition                |
| E18 | Model safety refusal on clinical content                                       | Distinguished from a technical error; clear message to the doctor                                     |
| E19 | Repair retry also fails                                                        | Stops at one retry. Error state, doctor writes the note manually                                      |

### 5.5 Edge cases — provider and infrastructure

| #   | Case                               | Expected behaviour                                                                                        |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| E20 | API key missing or invalid         | Clear server-side error; key never surfaces in a client response                                          |
| E21 | Rate limited (429)                 | Distinct, honest message — not a generic failure                                                          |
| E22 | Provider timeout, 5xx or very slow | Request timeout fires; UI stays responsive and cancellable                                                |
| E23 | **Provider fully unavailable**     | **Doctor can still write and save the consultation manually.** The single most important case — see §4.11 |

### 5.6 Edge cases — data, concurrency and flow

| #   | Case                                                             | Expected behaviour                                                           |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| E24 | Double-click Generate                                            | One in-flight call only; button disabled while pending                       |
| E25 | Double-click Save                                                | Exactly one consultation created — idempotency, not luck                     |
| E26 | Navigate away with unsaved edits                                 | Guard prompts before discarding (F15)                                        |
| E27 | Same consultation open in two tabs                               | Last-write-wins is acceptable — but decide it deliberately and write it down |
| E28 | Patient with no previous consultations; day with no appointments | Proper empty states, not blank panels or a spinner forever                   |
| E29 | Save with every AI field empty                                   | Allowed — free-text notes alone are a valid consultation                     |
| E30 | Editing then regenerating                                        | Doctor's edits are not silently overwritten; confirm first                   |
| E31 | Invalid appointment status transition (Completed → Waiting)      | Rejected at the API, not just hidden in the UI (F14)                         |

### 5.7 Edge cases — image upload (F17)

| #   | Case                                                      | Expected behaviour                                                        |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| E32 | Non-image or corrupt file                                 | Rejected at stage 0 with a specific message; no model call spent          |
| E33 | Blurry or unreadable photo                                | Rejected at precheck, or transcribed as `[illegible]` — **never guessed** |
| E34 | Image that is not clinical notes (a selfie, a screenshot) | Refused rather than transcribed                                           |
| E35 | Mixed printed letterhead + handwritten body               | Handwritten body transcribed, boilerplate skipped                         |
| E36 | Runaway output disproportionate to image content          | Treated as model fabrication → failure                                    |

### 5.8 Edge cases — security

| #   | Case                                      | Expected behaviour                                                                             |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| E37 | API key reachable from the browser bundle | Must be impossible. **The brief names this as its own example of a good engineering decision** |
| E38 | Accessing another doctor's patient by ID  | Note as a known limitation if auth (F21) is not built — do not pretend it is handled           |

### 5.9 The golden set (L3)

10–12 synthetic handwritten notes with known-correct expected output, covering the cases above rather than sampling randomly. Deliberately include:

- One clean, simple note
- One heavy in shorthand
- One containing a negation (E16)
- One containing an allergy that must survive (E17)
- One with no temperature mentioned, forcing `missingInformation` to fire
- One with no medication at all, forcing an empty array (E4)
- One with a crossed-out word
- One with a genuinely unreadable scrawl, to prove `[illegible]` fires (E33)
- One containing a prompt-injection attempt (E7)

**Write these by hand and photograph real handwriting** — no real patient data, ground truth known exactly, and the specific adversarial cases we need can be constructed on demand. Public prescription datasets are a secondary "does it generalise beyond my handwriting" check only, gitignored and never committed.

**Calibration:** MIRAGE — a fine-tuned, domain-specific model on Indian handwritten prescriptions — reports 82% accuracy on medication name and dosage extraction. A generic VLM misreading a drug name is therefore the expected floor, not a bug. This is precisely why stage 2's human checkpoint exists, and it belongs in the README.

**Scoring:** track per-field accuracy, hallucination count and omission count separately. An omission and a fabrication are different failures and averaging them hides both.

### 5.10 What is deliberately not tested

State these in the README as tradeoffs, not omissions:

- **No E2E / browser tests** — L2 covers the same path in-process for a fraction of the cost
- **No component tests** — low marginal value against the brief's weighting
- **No load or performance testing** — out of scope for the assessment
- **The model itself is not under test** — only the constraints around it

---

## 6. Decisions & Tradeoffs

The non-obvious choices, what each cost, and what would change the answer. This is the raw material for `AI_USAGE.md` section 4 — **fill it in as decisions are made, not reconstructed at the end.**

| Decision               | Chose                                              | Over                                   | Reasoning                                                                                                                                                                                                                                                                                                                                                  | Cost / revisit trigger                                                                                                               |
| ---------------------- | -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Orchestration          | Plain OpenAI SDK behind a thin `llm/` module       | LangChain / LangGraph                  | LangGraph earns its place with durable state, agent loops and tool orchestration. We have two independent model calls with an HTTP boundary between them — the "human in the loop" is a separate request and the state lives in Postgres. It also puts an abstraction between the developer and the prompt, which is exactly what the interview will probe | Retries and streaming are hand-rolled. Revisit if the pipeline grows real branching                                                  |
| Provider SDK           | OpenAI SDK direct                                  | Vercel AI SDK                          | Single provider already settled, credits available                                                                                                                                                                                                                                                                                                         | Revisit if F18 streaming is built — `streamObject` would make it nearly free                                                         |
| Handwriting extraction | Frontier VLM                                       | Tesseract / PaddleOCR / TrOCR          | Classical engines were built for separated printed characters. Tesseract ~12.5% CER on handwriting and 40–60% on cursive; PaddleOCR ~72.8%. Frontier VLMs reach 93–95%. For handwriting a VLM is the accurate option, not a shortcut                                                                                                                       | Per-call cost and latency versus a local engine                                                                                      |
| Pipeline shape         | Two separate calls with a human checkpoint between | One multimodal call, image → JSON      | Collapsing them removes the checkpoint, makes failures unattributable between transcription and structuring, and forces image fixtures into every structuring test                                                                                                                                                                                         | More tokens, more latency, one extra user action                                                                                     |
| Verification           | Deterministic code                                 | A second LLM as judge                  | Non-deterministic, costs a call, can hallucinate its own approval, untestable without mocking, and raises the question of who checks the checker. String matching is free, instant, and explainable to a doctor                                                                                                                                            | Crude on distant negation and double negatives. Escalation path: run a model _only_ on items the deterministic check flags ambiguous |
| Output schema          | The brief's schema, unchanged                      | Adding `vitals`, `diagnosis`, `dosage` | The cheapest hallucination guardrail is not giving the model a box to fill. A `diagnosis` field invites exactly the inference the brief tests for                                                                                                                                                                                                          | Less clinically complete — stated as intentional                                                                                     |

---

## 7. Data Model — entities

Names only. Fields, types and relations are worked out at implementation time.

### 7.1 Tables

| #   | Entity         | What it holds                                                                            |
| --- | -------------- | ---------------------------------------------------------------------------------------- |
| M1  | `Doctor`       | The clinician. One seeded record is enough until F21                                     |
| M2  | `Patient`      | Demographics, allergies, existing conditions                                             |
| M3  | `Appointment`  | A scheduled slot linking a doctor and a patient on a date                                |
| M4  | `Consultation` | The visit record — raw notes plus the doctor-confirmed structured note                   |
| M5  | `AiGeneration` | One AI attempt against a consultation: what went in, what came back, how it was verified |

### 7.2 Enums

| #   | Enum                 | Used by                                               |
| --- | -------------------- | ----------------------------------------------------- |
| M6  | `AppointmentStatus`  | M3 — Waiting / In Consultation / Completed (F14)      |
| M7  | `ConsultationStatus` | M4 — draft vs confirmed                               |
| M8  | `GenerationType`     | M5 — transcription (stage 1) vs structuring (stage 3) |
| M9  | `VerificationStatus` | M5 — passed / repaired / flagged / failed             |

### 7.3 Two shape decisions worth making now

**`AiGeneration` is a separate table, not columns on `Consultation`.** Regenerating produces several attempts against one consultation, and a transcription plus a structuring call are two generations for the same visit. Columns cannot hold that; a row per attempt can.

**One `AiGeneration` table for both stages, discriminated by `GenerationType`.** Transcription and structuring store the same things — input, raw output, model, prompt version, verification result, latency, tokens. Splitting them duplicates the schema for no gain.

Together these give the full audit chain (F12): image → transcript → doctor-corrected notes → AI structured output → doctor-confirmed note.

---

- [ ] Assignment decode + scoring-weight map
- [x] ~~Stack & architecture decisions~~ — done, §2
- [x] ~~Data model — entities~~ — done, §7 (fields/migrations at implementation time)
- [ ] API surface, validation, error taxonomy
- [x] ~~AI pipeline~~ — done, §4
- [x] ~~Guardrails~~ — covered inline per stage in §4
- [ ] Prompt design — full text of the stage 1 and stage 3 prompts
- [ ] Synthetic notes + expected outputs — write the actual 10–12 notes (designed in §5.9)
- [x] ~~Testing architecture & edge cases~~ — done, §5
- [ ] Build order & cut-line
- [ ] AI_USAGE.md + README capture strategy
