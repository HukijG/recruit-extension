# CLAUDE.md — Project conventions

Binding instructions for Claude working on this repo. These exist because
Claude's defaults are wrong for this codebase: text too small, spacing too
tight, colours too light, work dumped into the wrong file. Follow this doc
so the user doesn't have to keep correcting the same things.

## What this is

Plasmo + React Chrome extension for the LinkedIn Recruiter sidepanel. Three
modes (`sync`, `candidate`, `test_call`) routed by `src/sidepanel.tsx`.
Backend-of-record is Recruiterflow + Dialpad, both reached via a Cloudflare
middleware that owns API keys and aliases sensitive identifiers (caller IDs,
phone numbers) so they never sit in the browser. The middleware contracts are
summarised in the README's "Backend contract surface" section.

## Verifying changes

- **Type-check with `npx tsc --noEmit`** after every batch of edits. This is
  the contract for "compiles cleanly."
- **Do not run `pnpm build`** for dev iteration — the user runs `pnpm dev`
  themselves.
- **Do not use Playwright / browser automation** unless explicitly asked.

## Project structure (binding)

```
src/
├── sidepanel.tsx          orchestrator only — global CSS injection + mode routing
├── content.ts
├── lib/
│   ├── types.ts           shared interfaces
│   ├── contexts.ts        React contexts (cross-mode slots)
│   ├── formatters.ts      pure display helpers
│   ├── constants.ts       enums, storage instance, ms constants
│   ├── dialpad.ts         middleware-facing types
│   └── url.ts
├── components/
│   ├── candidate.tsx      shared candidate view (works in test_call + production)
│   ├── test-call.tsx      test_call mode wrapper
│   ├── sync.tsx           sync flow (CSV match → Recruiterflow push)
│   └── <feature>.tsx      one module per feature surface
└── background/messages/   one message handler per file
```

### Rules

1. **Never add new feature UI directly to `src/sidepanel.tsx`.** That file
   stays the orchestrator. New surfaces get their own module under
   `src/components/`.
2. **Each feature module owns its components, inline styles, and any CSS
   class injection it needs.** Don't sprinkle a feature's CSS classes into
   `sidepanel.tsx` — keep the feature self-contained. Sidepanel-global
   classes (`.lr-call-btn`, `.lr-invalid-btn`, `.lr-coldcall-*`,
   `lr-spark`) are an exception; they predate this rule.
3. **Shared types go in `src/lib/types.ts`.** Component-local types stay in
   the component file.
4. **Cross-mode hooks/slots go in `src/lib/contexts.ts`** as nullable
   contexts (see "Context-gating" below).
5. **Background messages: one file per handler in
   `src/background/messages/`.** Plasmo auto-routes by file name.

## Context-gating pattern (binding for mode-specific UI)

When a feature should appear in some modes and not others (e.g. picker only
in test_call, text composer only in test_call), do **not** thread props
through `sidepanel.tsx`. Instead:

1. Define a nullable context in `src/lib/contexts.ts`:
   ```ts
   export const TextSlotContext = createContext<TextSlot>(null)
   ```
2. The mode that wants the feature wraps its tree in a Provider that
   supplies the slot (callbacks, state, etc.).
3. The shared component reads the context and renders conditionally:
   ```ts
   const textSlot = useContext(TextSlotContext)
   ...
   {textSlot && <TextButton onClick={textSlot.onOpen} />}
   ```
4. Modes that *don't* want the feature render without the Provider; the
   default `null` value silently hides the UI.

Live examples: `CallerIdPickerContext` (caller-ID dropdown), `TextSlotContext`
(text composer trigger). Mirror these.

## Frontend design principles (binding)

These are minimums, not suggestions. Default to the upper end when in doubt
— it is far easier for the user to ask for less than to keep asking for
more. The user has explicitly said: **err on the side of bigger text, more
space, darker text, more padding.**

### Typography

| Role                          | Size      | Weight  | Colour    |
|-------------------------------|-----------|---------|-----------|
| Hero / page title (`h1`)      | 22-30px   | 600-800 | `#0d0d0d` / `#15171a` |
| Section heading (`h2`)        | 18-20px   | 700     | `#15171a` |
| Body / primary content        | 14-15px   | 400-500 | `#15171a` / `#2e3133` |
| Buttons (primary actions)     | 14-15px   | 600     | inherits |
| Labels (uppercase tags)       | 12-13px   | 600-700 | `#3c4043` |
| Captions / helper text        | 12-13px   | 400-500 | `#5f6368` |

- **Default body to 14-15px, not 12-13px.** 13px is only for caption-like
  subordinate content. Anything the user is expected to actively read gets
  ≥14px.
- **Headings get colour `#15171a` (near-black), never light grey.** If you
  catch yourself reaching for `#80868b` / `#888` / `#aaa` for a heading,
  stop.
- **Placeholder text must be `#2e3133` with `opacity: 1`** in inputs the
  user is expected to interact with — not the browser default light grey.
  Remember to set `opacity: 1` since Firefox dims placeholders by default.
- **Use a distinctive display font for hero/welcome titles** (the codebase
  uses `'ui-rounded, "SF Pro Rounded", "SF Pro Display", ...'`). Body text
  uses the system stack.

### Spacing

| Surface                       | Padding   |
|-------------------------------|-----------|
| Card (identity / job)         | 14-16px   |
| Modal / popover               | 22-26px   |
| Button (primary actions)      | 10-13px vertical / 10-14px horizontal |
| Form input / textarea         | 12-14px vertical / 14-16px horizontal |

| Spacing context               | Gap       |
|-------------------------------|-----------|
| Adjacent buttons in a row     | 8-10px    |
| Sections within a card        | 6-12px    |
| Stacked blocks (column flex)  | 10-16px   |
| Confirm prompt → buttons      | 10-12px   |

- **Default to the upper end.** If a layout looks tight, it is.
- **Don't reach for 4-6px gaps** unless the elements are deliberately
  clustered (icon + label, dot + text). Primary structure uses 10px+.
- **Card and overlay padding is interior breathing room.** 10px feels
  cramped; 14-22px is the comfort zone.

### Colour palette

```
#15171a   primary heading / dark text
#2e3133   body / placeholder / job company
#3c4043   labels / muted body
#5f6368   helper / hint text  (lower bound — don't go lighter for any
                               readable content)

#0a66c2   LinkedIn primary blue (Text button, primary CTAs, focus ring)
#084e9c   LinkedIn primary blue hover

#1f9d55   confirm / call green
#178044   confirm / call green hover
#157040   "positive" outcome text

#d23a2c   destructive red (Number Invalid, X close)
#b8302a   destructive red pressed / marked
#a82a20   "negative" outcome text

#e3e6ea   card / popover border
#d6dbe1   input border
#eef0f2   disabled background
#f4f6f8   subtle hover background
```

- **Don't introduce new shades** without checking this list. The palette is
  small on purpose.
- **Never use a flag emoji for caller-ID country tags.** Chrome on Windows
  doesn't render regional-indicator pairs and shows the letters instead.
  Use plain text — `formatCallerOption` is the canonical example.

### Buttons

- **Primary actions (Call, Send Text, Yes-confirm):** filled pill,
  `border-radius: 999px`, `padding: 10-13px 10-14px`, white text on
  saturated background, `transition: 120ms ease` on bg/border/transform/
  shadow. Reference: `.lr-call-btn`, `.lr-text-send-btn`.
- **Destructive actions (Number Invalid, X close):** outlined pill /
  circle, transparent background → fills with the destructive colour on
  `:hover`. Reference: `.lr-invalid-btn`, `.lr-text-close-btn`.
- **Neutral actions (No-confirm):** outlined pill with neutral grey
  border (`#c2c8d0`), grey text (`#2e3133`), subtle bg shift on hover.
- **Don't put 3+ pill buttons on one row in the sidepanel.** Split into
  two rows. Reference: candidate-mode action area when `TextSlotContext`
  is provided.
- **Hover/focus states live in real CSS classes**, injected once per
  module (see `text-popover.tsx`). Do not try to do them with inline
  `onMouseEnter` / `onMouseLeave` if a class will work.

### Modals & popovers

- **Vertically centred by default.** `align-items: center` on the
  backdrop, not `flex-end`. Bottom-anchored is wrong for this sidepanel.
- **Height: 45vh + min-height ~360px** when content is more than a single
  field. Don't default to 30vh — it feels cramped on tall sidepanels.
  Don't go past 60vh for a focused composer.
- **Width: full available width minus 16px backdrop padding.** No
  artificial max-width unless the surface is content-constrained.
- **Backdrop: `rgba(15, 23, 42, 0.32)`** — visibly dims the sidepanel
  without going opaque.
- **Open animation: ~220ms cubic-bezier(0.22, 1, 0.36, 1) pop-in,
  combined with a 160ms fade on the backdrop.** The codebase uses
  `lr-text-pop-in` / `lr-text-fade-in` keyframes.
- **Close behaviour:** explicit close affordance only (X button, Cancel
  button). Don't close on backdrop click unless the user asks for it. If
  the user is mid-input, focus loss must not destroy their work.
- **Autofocus the first input on open.**

### Layout direction

- **Identity / candidate cards: column layout** with name above phone
  above picker above action row.
- **Action rows: 1-2 buttons in one row, 3+ split across two rows.**
  Number Invalid lives on its own row when a Text button is present.
- **Forms / composers: vertical stack** with input area `flex: 1` so it
  fills the popover; header and action footer are `flex-shrink: 0`.

## Code style

- **Type-check, don't bypass.** No `any`, no `// @ts-ignore` unless
  there's a real reason and a comment.
- **Inline styles for static layout, CSS classes for hover/focus/
  animation.** Don't try to do hover with `onMouseEnter` if a class will
  do it.
- **No comments that just restate WHAT.** Comments explain WHY — a
  constraint, an incident, a non-obvious invariant. The candidate /
  test-call modules have good examples (`// Production candidate-mode
  renders without a Provider, so CallButton reads {} ...`).
- **No backend wiring when the user says "UI only."** Stub with
  `console.log({ payload })` and a `// Backend wiring deferred —` comment
  pointing at where the real call goes.
- **Drop dead code** when you remove its only caller (e.g. `countryFlag`
  was deleted with the flag-emoji formatter).
- **No prod builds for verification.** Use `npx tsc --noEmit`.

## Don'ts (recap)

- ❌ Don't dump feature UI into `sidepanel.tsx`.
- ❌ Don't default to 12-13px text for primary content.
- ❌ Don't default to 4-8px padding/gaps.
- ❌ Don't use `#888` / `#aaa` / `#80868b` for headings or primary text.
- ❌ Don't use light placeholder text where the user is expected to read it.
- ❌ Don't bottom-anchor modals.
- ❌ Don't go below 45vh height on a non-trivial overlay.
- ❌ Don't cram 3+ buttons into one row.
- ❌ Don't use flag emoji for country labels in selects.
- ❌ Don't run `pnpm build` for dev iteration.
- ❌ Don't add backend wiring when the user says "UI only".
- ❌ Don't use Playwright unless asked.
