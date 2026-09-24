# Manual test — before attaching an OpenAI key

A by-hand pass over everything that works **without** a real model. The AI
calls are served by the stub client from B0, so Generate and photo-transcribe
both respond — they return a fixed fixture instead of calling OpenAI.
Everything around them is real: verification, the audit trail, the retry, save,
status transitions, CORS, the guards.

Work top to bottom. Each check says what to do, what should happen, and — where
it is not obvious — **why it matters**, so a wrong result tells you something.

---

## 0. Start it up

```bash
# Postgres (should already be running)
docker ps --filter "publish=15432"

# Re-seed to a known state. Do this if the date has changed since you
# last seeded — appointments are created for "today", so yesterday's
# seed leaves today's list empty.
cd apps/api && bun run src/db/seed.ts

# API — NODE_ENV=test routes AI calls to the stub
cd apps/api && NODE_ENV=test bun run src/index.ts

# Web, in a second terminal
cd apps/web && bun run dev
```

Expected seed output: `doctors: 1, patients: 12, todaysAppointments: 6,
pastConsultations: 4`.

**The web port is not necessarily 3000.** Next takes the next free port if
3000 is occupied — on this machine another application holds it, so you will
usually land on **3005**. Read the actual URL from the `bun run dev` output.
The API accepts any localhost port in development, so a shifted port is fine.

| Check | Expect |
|---|---|
| `curl localhost:4000/health` | `{"ok":true}` |
| Open the web URL | Dashboard with 6 appointments |
| Browser console | **No errors, no hydration warnings** |

> If the dashboard shows a network error while `/health` works, it is CORS
> rather than a dead backend — check the API is the one you just started.

---

## 1. Dashboard (F1)

| # | Do | Expect |
|---|---|---|
| 1.1 | Look at the list | 6 appointments, earliest first |
| 1.2 | Read the times | **09:00 am … 12:30 pm** — clinic time (IST), not UTC |
| 1.3 | Read the tab counts | All 6 · Waiting 3 · In consultation 1 · Completed 2 |
| 1.4 | Click each filter tab | List narrows; counts stay the same |
| 1.5 | Click **Completed** | 2 rows |
| 1.6 | Change the date to tomorrow | **"No appointments on this date"** — an empty state, not a blank panel or a spinner |
| 1.7 | Change it back | 6 rows return instantly (cached) |

**Why 1.2 matters:** the API returns UTC (`03:30Z`). If you see **03:30 am**
the timezone conversion has broken, and every time in the app is wrong by
5½ hours.

---

## 2. Patient profile and history (F2, F3)

| # | Do | Expect |
|---|---|---|
| 2.1 | Click **Sunita Devi** | Profile page |
| 2.2 | Look at the top | **Red bordered banner: "Allergy — Sulfa drugs"** |
| 2.3 | Below it | "Existing conditions — Type 2 Diabetes Mellitus" |
| 2.4 | Scroll to history | 2 consultations, newest first |
| 2.5 | Click one open | Chief complaint, symptoms, history, medications, plan |
| 2.6 | Inside it, open **Original notes** | The doctor's raw text |
| 2.7 | Go back, open **Kavita Rao** | **"No known allergies"** (quiet grey) and **"No previous consultations"** |

**Why 2.2 and 2.7 are a pair:** the allergy has to be impossible to miss, and
"no known allergies" has to be *stated* rather than left blank — otherwise
"checked, none" and "nobody looked" are indistinguishable.

**2.5:** you should **never** see a `sourceSpan` on screen. It exists in the
data for verification only.

---

## 3. Writing notes (F4)

| # | Do | Expect |
|---|---|---|
| 3.1 | Dashboard → **Start consultation** on a *Waiting* row | Lands on the consultation page |
| 3.2 | Look at Generate | **Disabled**, with "Write some notes first" |
| 3.3 | Type a few spaces only | Still disabled — whitespace is not content |
| 3.4 | Type `C/O fever x3d` | Generate enables; "Unsaved changes" then "Draft saved" |
| 3.5 | **Reload the page** | **Your text is still there** |
| 3.6 | Watch the counter | `14 / 10,000`, grey |

**3.5 is the real check.** The draft is autosaved to the server, not
localStorage — so it survives a reload, a crash, or opening the same
consultation on another machine.

---

## 4. Generate and review (F5, F6) — the important section

The stub always returns the same note, built from this text:

```
fever since 3 days, mild cough
no breathing difficulty
took paracetamol yesterday
allergic to penicillin
advised hydration, rest
return if symptoms worsen
```

### 4a. Deliberately mismatched — flags should fire

| # | Do | Expect |
|---|---|---|
| 4.1 | With only `C/O fever x3d` in the box, press **Generate** | Toast "Note generated"; a dashed-border **AI draft** panel appears |
| 4.2 | Read the summary | **"9 items need checking"** in amber |
| 4.3 | Look at the items | Red boxes under almost every field: *"…does not appear in your notes"* |

**This is correct, not a bug.** The stub's output does not match what you
typed, so verification reports it. That is B4 doing its job: every item is
checked against your actual notes.

### 4a-ii. The dropped-allergy check (E17)

Grounding catches invented text. It can never catch something *missing* —
which is why there is a separate check, and why it is worth seeing fire.

| # | Do | Expect |
|---|---|---|
| 4.4 | New consultation. Notes: `C/O fever x3d` then a second line `allergic to sulfa drugs` | — |
| 4.5 | Press **Generate** | — |
| 4.6 | Look for a **red bordered banner** in the summary area | *"Your notes mention 'allergic to sulfa drugs' but it is missing from the history"* |

The stub's fixture lists a *penicillin* allergy, so the sulfa one you wrote
has vanished from the structured note. That banner is standalone — it has no
item to sit beside, because the whole problem is that the item is not there.

> With `C/O fever x3d` alone (4.1) you get **no** survival flag, correctly:
> your notes never mentioned an allergy, so nothing was dropped.

### 4b. Matched — should pass clean

| # | Do | Expect |
|---|---|---|
| 4.7 | Replace the notes with the six lines above, wait for "Draft saved" | — |
| 4.8 | Press **Generate** | — |
| 4.9 | Read the summary | **Green: "Every item traces back to your notes."** |
| 4.10 | Look for red boxes | **None** |

### 4c. Editing

| # | Do | Expect |
|---|---|---|
| 4.11 | Edit any field | Text changes; **no field is read-only** |
| 4.12 | Click **Add symptom** | Empty input appears |
| 4.13 | Type in it | Cursor **stays put** — no focus loss |
| 4.14 | Remove a middle item with **×** | It goes; the others keep their text and cursor |
| 4.15 | Look above the save button | **"Not recorded in these notes"** nudge |
| 4.16 | Dismiss it with **×** | It closes — and **Save is still enabled** |

**4.16 is the point of the nudge.** It informs and gets out of the way. If
dismissing it disabled anything, that would be a blocker in disguise.

### 4d. Guards

| # | Do | Expect |
|---|---|---|
| 4.17 | Press **Generate** and immediately press again | Second press does nothing — button disabled, shows "Generating…" |
| 4.18 | Edit a field, then press **Regenerate** | **Dialog: "Replace your edits?"** |
| 4.19 | Choose **Keep my edits** | Nothing regenerates; your text survives |
| 4.20 | Regenerate with no edits made | No dialog — nothing to lose |

**4.17:** two Generate presses are two model calls, two audit rows, and two
answers racing to overwrite each other.

---

## 5. Photo upload (F8)

The stub returns the six-line transcript above for any valid image. Use any
JPEG/PNG **at least 600×600**.

| # | Do | Expect |
|---|---|---|
| 5.1 | Drag an image onto the dropzone | "Reading the handwriting…" then text in the textarea |
| 5.2 | Check the note above the box | "Transcribed from a photograph" |
| 5.3 | **Check Generate** | **Still not pressed — nothing generated by itself** |
| 5.4 | Edit one character | The "transcribed" notice **disappears** |
| 5.5 | Type something, *then* upload | Your text is **kept**; the transcript is appended below it |
| 5.6 | Upload a `.txt` renamed to `.jpg` | Rejected: "Choose a JPEG, PNG or WebP image" |
| 5.7 | Upload a tiny image (~100×100) | Rejected: image too small |

**5.3 is the product thesis.** Transcription must never chain into
structuring — the doctor reads and corrects the transcript first. If a draft
panel appeared on its own, that is a serious regression.

**5.4:** the notice is a claim about provenance. Once you have edited it, the
text is yours, so the claim stops being true.

---

## 6. Save (F7, F15)

| # | Do | Expect |
|---|---|---|
| 6.1 | Note the patient's name and history count | — |
| 6.2 | Press **Save to patient record** | Toast "Consultation saved"; lands on the patient page |
| 6.3 | Count the history | **Exactly one more** than before |
| 6.4 | Open the new entry | Your **edited** text — not the AI's original |
| 6.5 | Go to the dashboard | That appointment now reads **Completed** |
| 6.6 | Reopen the consultation | Read-only; "Saved note"; **no** "Not saved" badge |

**6.3:** one save, one entry. **6.4:** if you see the AI's wording instead of
your corrections, the wrong note was saved.

---

## 7. Unsaved-work guard (F16)

| # | Do | Expect |
|---|---|---|
| 7.1 | Open a draft consultation, edit a draft field | **"You have unsaved changes"** appears |
| 7.2 | Click **Back to patient** | **Confirm dialog** |
| 7.3 | Cancel | You stay; edits intact |
| 7.4 | Try closing the tab | Browser's own "Leave site?" prompt |
| 7.5 | Reload a page you have **not** touched, then navigate away | **No prompt** |

**7.5 matters as much as 7.2.** A guard that fires on a clean form is one a
doctor learns to dismiss without reading.

---

## 8. Search (F17)

| # | Do | Expect |
|---|---|---|
| 8.1 | Type `R` in the header search | **Nothing happens** — under the 2-character minimum |
| 8.2 | Type `Ram` | A **Patients** section with **Ramesh Iyer** *and* **Vikram Patel** — matched mid-name — plus a **Consultation notes** section |
| 8.3 | Type `iyer` | Ramesh, matched on surname |
| 8.4 | Type `hypertension` | A **Consultation notes** section with a date and excerpt |
| 8.5 | Type `zzzqqq` | **"No patients or notes match…"** |
| 8.6 | Click a result | Navigates to that patient; dropdown closes |
| 8.7 | Click outside the dropdown | It closes |

**8.1:** the API rejects a 1-character query with 422. The UI simply does not
ask, so you never see that error mid-word.

---

## 9. Graceful degradation (E23) — the one to try

This is the guardrail the plan calls most important. **Stop the API**
(Ctrl-C), restart it with the AI switched off:

```bash
cd apps/api && LLM_ENABLED=false NODE_ENV=test bun run src/index.ts
```

| # | Do | Expect |
|---|---|---|
| 9.1 | Start a consultation, type notes | Works normally; draft saves |
| 9.2 | Press **Generate** | **"AI assistance is unavailable — you can still write and save this consultation yourself, nothing is lost"** |
| 9.3 | Try a photo upload | Same honest refusal |
| 9.4 | Look for a save button | **"Save without a structured note"** is present |
| 9.5 | Save | Succeeds; appears in patient history |
| 9.6 | Check the raw notes in history | Your text, preserved |

**The whole point:** the AI is an accelerant, not a dependency. If you cannot
complete a consultation here, that is the most serious possible failure — it
means a provider outage stops the clinic working.

Verified working at the API level: `POST /structure` returns **503
AI_UNAVAILABLE** with that message, and `POST /confirm` still returns **200**.

Restart without `LLM_ENABLED=false` afterwards. Each consultation you start
consumes one appointment (there is a unique constraint), so re-seed if you run
out of *Waiting* rows:

```bash
cd apps/api && bun run src/db/seed.ts
```

---

## 10. Errors, states and polish

| # | Do | Expect |
|---|---|---|
| 10.1 | Open `/dev/states` | Every loading, empty and error state on one page |
| 10.2 | Read the error list | Seven distinct failures, each with its own wording |
| 10.3 | Count retry buttons | **6 of 7** — the 404 has none, because retrying a 404 gives a 404 |
| 10.4 | Visit `/no-such-route` | "Page not found" with a link back |
| 10.5 | **Stop the API**, reload the dashboard | "Could not reach the server. Check that the API is running." **with a working Try again** |
| 10.6 | Restart the API, press **Try again** | Appointments load |

### Phone width

| # | Do | Expect |
|---|---|---|
| 10.7 | Resize to ~375px (or device toolbar → iPhone SE) | No horizontal scrollbar |
| 10.8 | Look at an appointment row | **Stacked**: time + name on one line, button full width below |
| 10.9 | Use the header search | Narrow input; dropdown wide enough to read, not off-screen |
| 10.10 | Walk sections 1–6 again at this width | Nothing clipped or overlapping |

### Tabs and a11y

| # | Do | Expect |
|---|---|---|
| 10.11 | Open the dashboard, a patient and a consultation in three tabs | Three **different** tab titles |
| 10.12 | From the dashboard, press Tab repeatedly | Visible focus ring on every stop |
| 10.13 | Tab to a row's button and press Enter | Opens the consultation |
| 10.14 | Keep the console open throughout | **No errors, no hydration warnings** |

---

## What is NOT covered here

These need a real API key and are deliberately out of scope for this pass:

- **Whether the prompts actually work.** The stub returns a fixture, so nothing
  here tests B2's transcription rules or B3's structuring rules. A real model
  might invent a blood pressure, pad an empty array, or expand `PCM` at the
  wrong stage — none of which this pass can see.
- **`[illegible]` highlighting in practice.** The stub's transcript contains no
  markers, so the amber highlight and its warning banner never appear. To see
  them you need a photo of genuinely unreadable handwriting.
- **The golden-set eval (B8).** Twelve notes, scored for hallucinations and
  omissions separately. Stage 3 of it needs only a key; stage 1 also needs the
  twelve notes photographed.

Everything in sections 0–10 is real code doing real work. The stub replaces
exactly two functions — `transcribeImage` and `structureNotes` — and nothing
else.

---

## Recording what you find

For anything that looks wrong, note:

1. **Which check** (e.g. 4.7)
2. **What you saw** versus what the table says
3. **Anything in the browser console**
4. **Whether it reproduces** on a reload

A screenshot of the console plus the check number is usually enough to act on.
