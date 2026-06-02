# SOP — Map Mode (numbered voice/keyboard command navigation)

> **For:** the implementing agent (and Mario) picking this up.
> **Status:** ready to build. Mechanics already proven in a standalone prototype.
> **Sister SOPs:** `docs/SOP_SELECTION_CONTEXT.md` — Map Mode **extends the exact same
> Sandpack runtime + `lovable-select` postMessage bridge** that Selection-as-Context built.
> Read §10 of that SOP before touching the runtime.
> **Hard rule from `AGENTS.md`:** This is NOT the Next.js you know. Read
> `node_modules/next/dist/docs/` before writing any Next.js-specific code.
> **Global rule (`CLAUDE.md`):** verify locally, then STOP and ask Mario before any commit/push.

---

## §1 — Executive Summary

Add a **Map Mode** to the editor. The user says (or types) **"map mode"** → every clickable
and typeable element in the live preview (and, Phase 2, the builder chrome) gets a small,
**non-blocking number badge**. From then on the assistant **asks nothing and answers nothing** —
it only executes:

- say **"2"** → it clicks element 2 instantly (no LLM, no talk-back)
- say **"4"** then speak → it transcribes your speech straight into field 4
- to commit/move on, say the next number (or a fixed verb like **"send"**)
- because a spoken number is *always* a command, your dictated text **must not end in a
  number** — if it needs to, say **"period"** to close the text, then the number/key
- say **"map mode off"** → badges vanish, the assistant returns to normal conversational mode

The whole point is **latency**. Normal mode routes every utterance through speech→LLM→action→
talk-back (several seconds, with ambiguity/correction tax). Map mode collapses a number to a
**local parse + a single postMessage → DOM action (~20–80 ms of work)**. The standalone prototype
(`C:\Users\mario\pet-marks-demo\`) already demonstrates the numbering, the command grammar, the
dictation/period rule, push-to-talk, and a built-in **stopwatch** so we can measure map-mode vs
conversation on real hardware. This SOP ports that engine into the builder on top of the existing
selection bridge.

**This is NOT Selection-as-Context.** Selection = "point at one thing, then *describe in English*
what to do, LLM does it." Map mode = "address things by number, *command them directly*, no LLM."
They share the iframe runtime and the bridge; they are different interaction models and can coexist.

---

## §2 — Feature Goal

Let the user operate the builder **hands-off the mouse and without conversational latency**:
a tight, deterministic command language (numbers + a few fixed verbs) spoken or typed, executed
the instant it's recognized. And let us **measure** how much faster that is than chatting.

**Success looks like:** User says "map mode." Numbers appear. "Two." (form opens.) "Four."
(field focuses.) "Joe's Coffee on South Padre." (typed.) "Send." (committed.) "Seven." …
No "okay, doing that," no "which button did you mean," no waiting on a model. Then "map mode off"
and they're back to normal chat. A task-timer readout shows the second-by-second cost of each step.

**Out of scope (v1):**
- Replacing normal conversational chat (map mode is a *parallel* mode you switch into).
- LLM-assisted "go to the publish button" by description (that's normal mode; map mode is numbers).
- Multi-step macros / recording (Phase 3+).
- Touch / mobile (desktop-first, same as Selection SOP §6.5).

---

## §3 — Architecture (where each piece runs)

Two DOM contexts, one controller:

```
┌─ Parent (Next.js editor route) ─────────────────────────────────────────┐
│  MapModeController  (new)                                                │
│   • HUD: command input + 🎤 push-to-talk + ⏱ task timer + action log     │
│   • Web Speech recognizer  → normalize → command parser                  │
│   • mode state + master registry (Zustand: lib/mapmode-store.ts)         │
│   • Phase 2: numbers the BUILDER CHROME itself (same-document)           │
│                                                                          │
│        ▲  acted{num,ms}            │ act{kind,num,text}                   │
│        │  marks[]                  ▼ mapmode-enable/disable/refresh       │
│   preview-panel.tsx bridge  ── postMessage("lovable-select", v:1) ──┐    │
└─────────────────────────────────────────────────────────────────── │ ──┘
                                                                       ▼
┌─ Sandpack preview iframe (the user's app being built) ──────────────────┐
│  __lovable_select_runtime.ts  (EXTEND existing file)                     │
│   • on mapmode-enable: enumerate selectable+typeable els, number in      │
│     reading order, render NON-BLOCKING badge overlay, post marks[]       │
│   • on act: focus / click / type(React-safe) / enter / clear element N   │
│     INSIDE the iframe (this is where the DOM actually lives), post acted │
│   • reposition badges on scroll/resize; re-number on Sandpack remount    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Why numbering must happen inside the iframe:** the page being built is a separate document in
the Sandpack iframe. The parent cannot reliably read or click into it cross-document, but the
already-injected runtime *can*. We reuse it. The builder *chrome* (Phase 2) is the parent document,
so the parent numbers that directly (port the prototype engine).

---

## §4 — The command language (lock this exactly — it's Mario's spec)

**Modes**
- **Normal mode** (default): chat works exactly as today. Map mode is OFF.
- **Map mode**: entered by **"map mode"** (voice) / Map-mode toggle / `Alt+\``. While ON, the
  controller **intercepts every utterance and routes it to the parser — it NEVER sends to chat/LLM,
  never speaks back.** Exited only by **"map mode off"** / toggle / `Esc`.

**Inside map mode**
| You say / type | Result |
|---|---|
| a number (`2`, `"two"`, `"twenty six"`) | focus #N if it's a field (→ dictation), else click #N — instantly |
| speech while a field is focused | transcribed verbatim into that field |
| **"period"** | closes the dictated text so the **next number is read as a command**, not typed |
| **"send"** / **"enter"** | commit (press Enter on the focused field) — fixed verb, works with no Enter button |
| **"clear"** | empty the focused field |
| **"back"** / **"scroll up/down"** / **"top"** / **"bottom"** | navigation |
| **"map mode off"** | exit to normal mode |

**The number-is-always-a-command rule (the key to zero ambiguity):** a recognized number is
*always* an action, even mid-dictation — so it can never be typed by accident. Consequence:
**dictated text must not end in a number.** If the content itself ends in a digit ("Suite 14"),
say it, then **"period"**, then the command number. With push-to-talk this is mostly automatic
(each press = one utterance: one press for the text, a separate press for the number), so "period"
is the explicit fallback for one-breath cases.

---

## §5 — Message protocol (extends `lovable-select` v:1 — reuse existing validation)

Same `{ source: "lovable-select", v: 1, type, payload }` envelope and origin checks already in
`preview-panel.tsx:516` and `select-runtime.ts:262`. New types:

**Parent → iframe**
| `type` | `payload` |
|---|---|
| `mapmode-enable` | `{}` — enumerate, number, render badges, reply `mapmode-marks` |
| `mapmode-disable` | `{}` — remove badges + listeners, zero residual cost |
| `mapmode-refresh` | `{}` — re-enumerate + reposition (after scroll/remount) |
| `mapmode-act` | `{ kind: "click"\|"focus"\|"type"\|"enter"\|"clear", num?: number, text?: string }` |

**Iframe → parent**
| `type` | `payload` |
|---|---|
| `mapmode-marks` | `{ marks: Array<{ num, tag, name, typeable, bbox }> }` |
| `mapmode-acted` | `{ num?, label, execMs }` (drives the parent action log + stopwatch) |
| `ready` (existing) | reused — on Sandpack remount, parent re-sends `mapmode-enable` if mode is on |

Reuse `preview-panel.tsx`'s `getIframe()` + `post()` (lines ~460/468) verbatim.

---

## §6 — File manifest

**New**
| Path | Purpose |
|---|---|
| `lib/mapmode-store.ts` | Zustand: `isMapMode`, `marks`, `focusedNum`, `dictating`, metrics |
| `lib/preview-bridge.ts` | tiny singleton so the controller can `post()` to the iframe + subscribe to messages (preview-panel registers it on mount) |
| `components/editor/map-mode-controller.tsx` | HUD + Web Speech + command parser + task timer + action log |
| `components/editor/map-mode-badges-chrome.tsx` | *(Phase 2)* parent-document badge overlay for builder chrome |

**Modified**
| Path | Change |
|---|---|
| `worker/src/ai/runtime/select-runtime.ts` | add map-mode block: enumerate/number/badges + `act` executor (see §7) |
| `worker/src/ai/default-project.ts` | the runtime is inlined here too — regenerate this copy from the source file so they stay identical |
| `components/editor/preview-panel.tsx` | handle new message types; expose `post()`/subscribe via `lib/preview-bridge.ts`; on `ready` re-enable if map mode on; post `mapmode-refresh` on scroll/resize |
| `components/editor/editor-shell.tsx` | mount `<MapModeController projectId=… />` (top level, spans chat + workspace) |

No worker chat-route or auth changes. No new env vars or secrets. Map mode is pure client + iframe.

---

## §7 — Runtime extension (inside the iframe) — behavior spec

Add to `select-runtime.ts` (reuse its `isSelectable`, `truncate`, `send`, capture-phase listener
discipline, and the §N "no residual cost when off" rule from the Selection SOP):

- **Selector set** (superset of select mode): `a[href], button, input:not([type=hidden]), select,
  textarea, [contenteditable], [role=button|link|tab|menuitem|checkbox|switch|radio], [tabindex],
  [onclick]` — visible, not disabled, in viewport.
- **`typeable(el)`**: textarea / contenteditable / text-like input types → focusing one enters
  dictation; everything else is click-only.
- **Numbering**: reading order — sort by `round(top/24)` band, then `left`. `Map<number, el>`.
- **Badges**: one `pointer-events:none` overlay container, a small chip per element at its
  bounding-box top-left, `z-index:2147483000`, repositioned on scroll/resize via `rAF`. **Must not
  block clicks or cover inputs** (this is Mario's explicit requirement).
- **`act`**:
  - `focus`/number-on-field → `el.focus()`, mark focused, badge turns green.
  - `click`/number-on-non-field → real `.click()` (capture-phase neutralized for our own click).
  - `type` → **React-safe** value set (native setter + `input`+`change` events — the same
    `setNativeValue` pattern already needed elsewhere in this app; see prototype).
  - `enter` → dispatch real `keydown/keyup` Enter; if in a form, `form.requestSubmit()`.
  - `clear` → set value "".
  - Each returns `mapmode-acted { num, label, execMs }` with `performance.now()` delta.
- **Remount**: runtime already posts `ready` on load; parent re-sends `mapmode-enable`.

The full, working reference for numbering + badges + the parser/grammar + stopwatch is the
prototype at `C:\Users\mario\pet-marks-demo\pet-marks.js` — port its logic; don't reinvent it.

---

## §8 — Parent controller — behavior spec

`map-mode-controller.tsx` (port `pet-marks.js`'s HUD + voice + parser + metrics):

- **Voice**: Web Speech API (`webkitSpeechRecognition`), **push-to-talk** = hold Space (or the 🎤
  button): start on press, stop on release → one utterance. PTT deletes endpointing latency (we
  know exactly when speech ends), which is the single biggest "feels instant" lever.
- **Wake/sleep phrases**: `"map mode"` / `"show numbers"` → enter; `"map mode off"` / `"hide
  numbers"` → exit. (v1: arm voice with a hotkey/toggle; always-listening wake-word is a Phase 3
  option.)
- **Routing (the deterministic guarantee)**: while `isMapMode`, the controller consumes the
  transcript and dispatches a command or a dictation-type. It **does not** call the chat endpoint
  and produces **no spoken/LLM response** — only the action + a one-line log entry. Exiting map mode
  hands voice/typing back to normal chat.
- **Normalization**: number-words→digits (incl. "twenty six"→26), homophone guard, fixed-verb map
  (`send/enter/submit→enter`, `clear`, `back`, `next/previous→tab`, `scroll…`, `period` delimiter).
- **Dispatch**: chrome-scoped number (Phase 2) → execute in parent; preview-scoped number →
  `post("mapmode-act", …)` to the iframe.
- **Instrumentation (so we can answer "how much faster")**: per action record `speak` (PTT held
  ms), `recognize` (release→transcript ms), `execute` (action ms). **Task timer**: Start → run the
  task → Stop prints `N actions in X.Xs`, plus speaking/recognition/execution totals. Run the same
  task in normal chat for the A/B.

---

## §9 — Build phases

**Phase 0 — Spike (DONE).** `C:\Users\mario\pet-marks-demo\` — numbering, grammar, period rule,
PTT, stopwatch, all working + syntax-verified. This SOP ports it in.

**Phase 1 — Map mode in the PREVIEW (the page being built).** The high-value 80%.
1. Extend `select-runtime.ts` per §7; regenerate the inlined copy in `default-project.ts`.
2. Extend `preview-panel.tsx` bridge per §5/§6; add `lib/preview-bridge.ts`.
3. `lib/mapmode-store.ts`.
4. `map-mode-controller.tsx` (keyboard-first parser + HUD + instrumentation), mount in `editor-shell.tsx`.
5. Add **voice (PTT)** + wake phrases on top of the working keyboard core.
6. Acceptance §10 + first **A/B timing run** (§11).

**Phase 2 — Extend to the BUILDER CHROME ("the entire thing").**
- Parent numbers chrome controls (model selector, publish/export, device toggles, Supabase, tabs)
  in the same HUD/overlay, reserved low number range; preview elements offset above it. Now you can
  drive the builder *and* the page by number.

**Phase 3 — Production hardening / decision.**
- If Web Speech latency dominates the stopwatch, swap to streaming STT (Deepgram/Whisper) — the
  controller is STT-agnostic. Number-recognition biasing. Optional always-listening wake word.
  Optional macro recording ("do these 5 again").

---

## §10 — Acceptance criteria (Phase 1)

1. Saying/typing "map mode" shows numbered badges over every preview element; **badges never block
   a click or cover an input** (verify by clicking through a badge).
2. In map mode the assistant **emits no chat message and no spoken reply** for any command — only
   the action + a log line. (Verify: network tab shows **no** `/api/chat` call during map mode.)
3. A number focuses a field (→ dictation) or clicks a control, instantly.
4. Dictation types verbatim; a spoken number mid-dictation is treated as a command, never typed.
5. "period" then a number closes text and runs the number as a command (test with "Suite 14").
6. "send" commits the focused field with no visible Enter button present.
7. "map mode off" removes badges and restores normal chat (a normal typed message hits `/api/chat`).
8. Sandpack remount (after an AI edit lands) re-numbers within ~500 ms; numbers stay valid.
9. Task timer prints per-action `speak/recognize/execute` and a task total.
10. With map mode OFF, the runtime attaches zero map-mode listeners (no residual cost) — reuse the
    Selection SOP N-3 discipline.
11. No console errors across a full happy-path run.

---

## §11 — Measurement plan (the reason we're doing this)

Run the **same 3-step task both ways**, with the task timer, on Mario's machine:

> 1) open a form (click), 2) focus a field + dictate a value, 3) commit, then focus another field.

- **Map mode:** Start task → "two" → "four" → speak value → "send" → "seven" → Stop. Read totals.
- **Normal chat:** Start task → type/say the equivalent natural-language requests → Stop.

Record: total wall time, # actions, speaking vs recognition vs execution split, and any
correction/clarification round-trips in chat. Prototype modeling predicts **~2× faster (~10 s saved
on a 3-step task), trending to 3–4× on memorized/repeated workflows** — but the stopwatch gives the
real number on real hardware. Honest caveat: Chrome's Web Speech is cloud-based, so "recognize" ms
includes a network hop; a production STT will be faster — read Phase-1 numbers as "beatable."

---

## §12 — Risks & honest notes

- **Sandpack remount** wipes injected badges → must re-enable on `ready` (handled; test it).
- **STT latency floor** is shared by both modes and is cloud-dependent in Chrome → PTT mitigates;
  Deepgram is the Phase-3 escape hatch.
- **Number homophones** ("fifteen/fifty") → normalize + optionally prefer two-digit clarity.
- **Cross-iframe origin** → reuse the existing validated `lovable-select` handshake; never `"*"` on
  the parent's inbound check.
- **Don't regress Selection mode** — map mode adds message types alongside it; both must coexist
  (test: select mode still works after map-mode ships).
- **Scope creep** — v1 is "numbers execute commands." No macros, no LLM-in-map-mode, no mobile.

---

## §13 — Definition of done (Phase 1)

All §10 pass on a fresh editor session in WSL canonical (`/home/mario/lovable-clone`, :3015 +
worker :8799). A §11 A/B timing run is captured and pasted back here. Then **STOP and ask Mario for
push approval** before any commit/deploy (frontend auto-deploys on `git push master`; the worker
needs `wrangler deploy` — see `project_lovable_clone_deploy_mechanism`).

---

**End of SOP.** Prototype to port: `C:\Users\mario\pet-marks-demo\` (engine `pet-marks.js`,
demo `index.html`, server `serve.py` on :8096). Bridge/runtime to extend:
`worker/src/ai/runtime/select-runtime.ts` + `components/editor/preview-panel.tsx`.
