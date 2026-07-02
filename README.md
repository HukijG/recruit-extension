# recruit-extension

A Manifest V3 browser extension — plus an early-stage mobile companion — that turns a
LinkedIn Recruiter pipeline into a one-click sync into a recruiting CRM and dialer, and then
becomes an in-side-panel **cold-calling cockpit** for the recruiter making the calls. It is a
zero-secrets client: it holds no API keys, injects nothing into LinkedIn's page, and brokers
every third-party action through authenticated Cloudflare Workers behind a single-sign-on
identity.

> **Part of a three-repo system — and a thin client by design.** Everything here routes
> through [recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend) — candidate
> sync, calls/SMS, stats, templates, the OAuth identity itself — and the music bar
> remote-controls the office TV ([recruit-tv-dashboard](https://github.com/HukijG/recruit-tv-dashboard))
> through the backend's music worker. The wiring:
> [Backend contract surface](#backend-contract-surface--the-integration-seam) · [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md).

This is a portfolio copy of an internal tool. It is not affiliated with, endorsed by, or
connected to LinkedIn, Recruiterflow, Dialpad, or any other product named here; those names
appear only to describe what the extension integrates with.

It is shared **source-available for portfolio review** (see [`NOTICE.md`](NOTICE.md)). The
backend Cloudflare Workers that hold the API keys live in a separate repository
([recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend)) and are not
vendored here, so the public build performs no data acquisition on its own — **this repo is
the client and the contracts it depends on.** The architectural evolution narrative is in
[`docs/PROJECT_HISTORY.md`](docs/PROJECT_HISTORY.md).

<p align="center">
  <img src="docs/media/sidepanel-tour.gif" width="430" alt="The side panel cycling through its surfaces: sign-in, pipeline sync, CSV match review, the cold-call cockpit, the SMS composer, and the template manager">
</p>

*The side panel in action, captured in demo mode — every name, number, company, and track is
fictional. Stills: [sign-in](docs/media/sidepanel-signin.png) ·
[sync](docs/media/sidepanel-sync.png) · [match review](docs/media/sidepanel-review.png) ·
[cockpit](docs/media/sidepanel-candidate.png) · [composer](docs/media/sidepanel-composer.png) ·
[templates](docs/media/sidepanel-templates.png) · [all six](docs/media/sidepanel-collage.png).*

---

## The engineering underneath

Behind the sync button and the dialer sit three things that are genuinely hard to get
right in a browser extension:

- **A trust boundary that actually holds.** The extension is *deliberately dumb about
  secrets*: no third-party API key ever reaches the browser, sensitive identifiers (caller
  IDs, phone numbers, device IDs) are aliased into opaque tokens server-side, and the only
  credential the client ever sees is a short-lived OAuth access token held in the background
  service worker — never in React. This is the result of a full security re-architecture from
  a per-user shared secret to **Cloudflare Access SaaS-OIDC + PKCE**.
- **State durability across a hostile lifecycle.** MV3 service workers are killed and revived
  at will; side panels close and reopen; SPA navigation fires constantly; OAuth windows
  suspend the worker mid-flight. Auth refresh is promise-locked against stampedes, call state
  survives a panel reopen via persisted hydration, a candidate fetch is guarded against
  out-of-order responses, and a WebSocket reconnects on capped backoff with single-use ticket
  auth.
- **A boundary with LinkedIn's page that is ToS-aware by construction.** All UI lives in the
  browser Side Panel, never injected into LinkedIn's DOM; the public profile URL — the one
  field that makes a reliable CRM match — comes from the user's *own* native CSV export rather
  than from resolving internal references; everything is manual and user-triggered, reading
  only data already visible in the user's licensed Recruiter session.

> **Note on testing & CI.** This repo is intentionally the thin, UI-only client of a larger
> system, built by a single developer for an internal team — the testing rigor lives where the
> business logic lives. The backend carries **1,553 automated tests across five Cloudflare
> Workers, run against the real Workers runtime** (Miniflare), plus OpenTelemetry tracing and
> CI auto-deploys ([recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend));
> the TV kiosk carries **158 Rust tests + Playwright E2E suites**
> ([recruit-tv-dashboard](https://github.com/HukijG/recruit-tv-dashboard)). This repo's
> contract is a clean type-check: `npx tsc --noEmit` must pass with zero errors.

---

## What it is

Built by a working recruiter to solve actual desk problems, and in daily use by the whole
team today. Recruiters working a LinkedIn Recruiter project need each candidate to land in
the team's CRM (Recruiterflow) and dialer (Dialpad) so they can be contacted and tracked. The
native CRM extension that was supposed to do this was unreliable — it misidentified public LinkedIn
profiles (especially for candidates with hidden or abbreviated surnames) and lagged behind a
roughly two-hour webhook delay.

This extension replaces that flow, in two acts:

1. **Sync.** On a Recruiter pipeline page, select candidates, capture the visible rows, drop
   in the native CSV export to recover each candidate's *public* profile URL, review the
   matched set, and push everything to the CRM in one click — then optionally add the new
   records to a specific job.
2. **Cold-call cockpit.** Once a candidate is in the pipeline, opening that candidate turns the
   side panel into a calling surface: place a Dialpad call from a chosen caller ID, send a
   templated SMS, mark a number invalid (with an undo window), and watch live call state and a
   daily call counter — **without any phone numbers, caller IDs, or API keys ever touching the
   browser.**

A persistent **now-playing music bar** (a remote for the music player on the office TV —
[recruit-tv-dashboard](https://github.com/HukijG/recruit-tv-dashboard) — driven through the
backend's music worker over a live WebSocket) and **keyboard hotkeys** for call/hangup round
out the day-to-day ergonomics.

### The three side-panel modes

The side panel is a single React app that routes between three modes based on the active
LinkedIn tab's URL:

| Mode        | Activates when | What it does |
|-------------|----------------|--------------|
| `sync`      | On a Recruiter pipeline list | Capture selected pipeline rows → match against the CSV export → review → push selected candidates to the CRM, then add to a job. |
| `candidate` | A candidate profile is open | Per-candidate cold-call view: Dialpad call with a caller-ID picker, SMS template composer, "number invalid" with deferred-write + undo, live call-state button, and the candidate's recent cold-call activity. |
| `test_call` | User-triggered (developer harness) | Exercises the full candidate view against a fixed test number, with no real pipeline page needed — the same shared `CandidateView`, wired with an extra Text-composer slot. |

`src/sidepanel.tsx` is the **orchestrator** that routes between these modes and owns
cross-mode state; each mode and feature lives in its own module under `src/components/`.

---

## Stack

- **Extension framework:** [Plasmo](https://www.plasmo.com/) (Manifest V3) with React 18 + TypeScript
- **UI surface:** the browser Side Panel API — the extension never injects UI into LinkedIn's page DOM
- **Messaging:** `@plasmohq/messaging` (typed messages between content script, background worker, and side panel; one handler per file, auto-routed by filename)
- **Storage:** `@plasmohq/storage` over `chrome.storage.local`, read reactively in React via the `useStorage` hook
- **Auth:** Cloudflare Access SaaS-OIDC with PKCE/S256, driven by [`oauth4webapi`](https://github.com/panva/oauth4webapi) through `chrome.identity.launchWebAuthFlow`
- **CSV parsing:** Papa Parse (real parser — exports carry quoted multi-line headlines, emoji, and mangled accents)
- **Backends (in [recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend), not vendored here):** a Cloudflare Worker "middleware" fronting Recruiterflow + Dialpad, and a dedicated Cloudflare music worker fronting the office TV's player ([recruit-tv-dashboard](https://github.com/HukijG/recruit-tv-dashboard))
- **Mobile companion:** Capacitor + Vite + React (see [`mobile/`](mobile/README.md))
- **Tooling:** pnpm (extension) with a Prettier config and `tsc --noEmit` as the "compiles cleanly" contract; an env-validating prebuild gate fails the production build fast if config is missing. The `mobile/` companion is a separate npm project.

---

## Architecture at a glance

The extension is split across the three MV3 contexts — content script, side panel, and
background service worker — and talks to the outside world only through two Cloudflare Workers,
both gated by the **same** Cloudflare Access OAuth identity.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  LinkedIn Recruiter pipeline / profile page (DOM)                  │
  │                                                                    │
  │   content.ts  ── thin: reads already-rendered rows, scrolls to     │
  │                   load lazy rows, reads the open profile's URL.     │
  │                   Injects NO UI. No business logic.                 │
  └───────────────────────────┬────────────────────────────────────────┘
                              │  chrome.runtime messages
                              ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  Side panel  (React app — sidepanel.tsx + components/)             │
  │   • mode routing: sync / candidate / test_call                     │
  │   • CSV parse + match + review workflow                            │
  │   • cold-call cockpit, SMS templates, call-state UI                │
  │   • now-playing music bar                                          │
  │   • NEVER sees the access token                                    │
  └───────────────────────────┬────────────────────────────────────────┘
                              │  @plasmohq/messaging (typed, 1 handler/file)
                              ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  Background service worker  (background/)                          │
  │   • SOLE holder of the OAuth token                                 │
  │   • PKCE sign-in, promise-locked refresh                           │
  │   • authFetch: attaches Bearer, retries once on a refreshable 401  │
  │   • URL watcher → mode broadcasts;  command relay → hotkeys        │
  └─────────┬──────────────────────────────────────────┬───────────────┘
            │  authenticated fetch (Authorization: Bearer)
            ▼                                          ▼
  ┌───────────────────────────┐          ┌───────────────────────────────┐
  │ Cloudflare Worker:         │          │ Cloudflare Worker: music remote│
  │ middleware                 │          │ (→ the office-TV kiosk)        │
  │ (recruit-edge-backend)     │          │ (recruit-edge-backend)         │
  │  ├─► Recruiterflow (CRM)   │          │  ├─► office music player (HTTP)│
  │  └─► Dialpad (calls / SMS) │          │  └─► now-playing WebSocket     │
  │  owns API keys; aliases    │          │     (single-use ticket auth)   │
  │  caller IDs / numbers      │          └───────────────────────────────┘
  └───────────────────────────┘
            ▲                                          ▲
            └──────────────┬───────────────────────────┘
                          │ Cloudflare Access SaaS-OIDC (one OAuth identity for both)
                  ┌────────┴─────────┐
                  │ CF Access tenant │  ← PKCE sign-in via chrome.identity, stable
                  │  (OTP login)     │     extension ID pinned by CRX_PUBLIC_KEY
                  └──────────────────┘
```

Two Cloudflare Workers sit behind the extension — the **middleware** that fronts Recruiterflow
+ Dialpad, and a **dedicated music-remote worker** that proxies the office TV's player and
streams a now-playing snapshot over a WebSocket. Both live in
[recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend), both authenticate with
the *same* Cloudflare Access OAuth token, and the extension is locked only to their
request/response *contracts*.

---

## The trust boundary (the centerpiece)

The single most important design property is that **the browser holds no third-party
credential and never sees a raw sensitive identifier.** This is enforced structurally, not by
convention:

- **No API keys in the client.** The extension never talks to Recruiterflow or Dialpad
  directly. Every third-party action is a request to a Cloudflare Worker that owns the API keys
  server-side and performs the real operation.
- **Opaque identifier aliasing.** Caller IDs (and, server-side, phone numbers and device IDs)
  are never sent to the browser as real values. The middleware hands the picker a list of
  *opaque alias tokens* with only a coarse country tag (`UK` / `US` / `OTHER`) and an optional
  label; the extension echoes an alias back when initiating a call, and the worker decodes it
  to the real E.164 number. A raw number never sits client-side. (There is deliberately no
  device picker — Dialpad's `initiate_call` rings every eligible device and the user picks up
  wherever they are.)
- **A background-only access token.** The OAuth access token lives exclusively in the
  background service worker. React reads *session presence* reactively from
  `chrome.storage.local`, but the token itself is attached to outbound requests only inside the
  worker's `authFetch`. A module-placement rule keeps write helpers for the auth keys in
  `background/` so React/content code physically cannot import them.

---

## Component-by-component

### Content script — `src/content.ts`

Runs in the LinkedIn Recruiter page context and is kept **as thin as possible**: it detects
whether the current page is a pipeline list, reports how many rows are selected, scrolls to
force LinkedIn to render its lazily-loaded rows, reads the rows the user has *already selected*,
and reads the public profile URL from an open candidate profile. It injects **no UI** and holds
**no business logic** — all parsing, matching, and dispatch happen in the side panel, isolated
from LinkedIn's page. The profile-URL read polls on a short cadence up to a 10-second wall-clock
deadline, because LinkedIn's candidate side panel hydrates anywhere from <50 ms to several
seconds after the URL changes — a fixed short timeout used to race fast machines into a false
"couldn't read profile" error.

### Side panel orchestrator — `src/sidepanel.tsx`

The React app and workflow owner. It is a *pure orchestrator*: it injects the one-shot global
stylesheet, routes between the three modes, and owns cross-mode state (auth gating, the
now-playing bar, the daily call-stats badge, the polled call-state hook). It deliberately
contains **no feature UI** — each surface is its own module.

Mode-specific features are wired through **nullable React contexts** (`src/lib/contexts.ts`)
rather than prop-drilling: a mode "opts in" to a feature by wrapping its subtree in a Provider
that supplies the slot (e.g. `CallerIdPickerContext`, `TextSlotContext`, `CallStreamContext`,
`MusicRemoteContext`); a mode that doesn't want the feature simply renders without the Provider
and the shared component reads the default `null` and hides the UI. This is what lets the same
`CandidateView` serve both production candidate mode and the `test_call` harness with different
feature sets.

### Sync flow — `src/components/sync.tsx`

The CSV-match engine and the CRM push. The core insight is that the one field that makes a
reliable match — the candidate's **public** profile URL — is already present in LinkedIn
Recruiter's *own native CSV export*. So rather than resolving internal references to public
profiles, the extension captures the selected on-page rows and the user drops in their own CSV;
the two are merged **locally**. The matcher:

- **Normalizes hostile input.** Real exports carry multi-line quoted headlines with emoji,
  mangled accents, abbreviated surnames, and stray whitespace. Names and companies are
  normalized with an NFD decompose → strip combining marks → lowercase → collapse-whitespace
  pass before any comparison.
- **Greedy one-to-one match with a confidence score.** Each captured candidate is matched to
  the best remaining CSV row by a score (exact normalized-name match is strong; a current-employer
  company match adds confidence); a matched CSV row is consumed so it can't be claimed twice.
- **Flags, never blocks.** An exact normalized-name match is `matched`; a best-but-inexact match
  is a `warning` (shown with both normalized strings so the user can eyeball it); a candidate
  with no scoring match is an `error`, unchecked by default. The user reviews and ticks the set,
  then sends — so a fuzzy edge case surfaces for a human instead of silently corrupting the batch.

The push is a batch upsert to the middleware; the response drives an "add these N to a job"
follow-up step with a searchable job picker.

### Cold-call cockpit — `src/components/candidate.tsx`

Activated when a candidate profile is open. On entry it auto-fetches that candidate's CRM record
(`/candidate-details`): RF id, phone (E.164), the picked job (title / company / stage), and the
candidate's recent cold-call activity. From there the consultant gets:

- **One-click Dialpad calling** with a caller-ID picker (opaque aliases only) and a live
  call-state button driven by polling (see below).
- **"Number invalid" with a deferred write + undo.** Arming the action starts a 5-second undo
  window before the POST fires; navigating to a different candidate mid-window is handled so a
  stale response can never pop a red error over the *new* candidate's view.
- **A daily call counter** badge in the header, refreshed on mount, on visibility, on candidate
  change, and after a call starts or a hangup.

A **race-safe candidate state machine** governs all of this: navigating to a new candidate wipes
and refetches, nothing is cached across candidates, and each fetch carries a monotonic request
token so an out-of-order response for a previous candidate is dropped.

### Live call state — `src/lib/callStream.ts`

Tracking whether a call is ringing, connected, or ended is the kind of thing you'd reach for
Server-Sent Events to solve — and the project did, first. **SSE was reversed in favour of
polling** because the SSE path through the extension/worker proved fragile across reloads,
tab/app switches, and SPA navigation. The replacement polls `POST /extension-call-status` on a
500 ms cadence, and is hardened well past a naive loop:

- **A 3-value local state machine** (`idle` → `calling` → `active`) translated from two wire
  states (`in_progress` / `ended`).
- **Polling is gated on state** — it runs only while there's a call to track; `idle` does zero
  network.
- **A 10-second watchdog** silently reverts a stuck `calling` to `idle` so the user can retry.
- **In-flight coalescing** (messaging can't be aborted, so a poll that's still out skips the
  next tick).
- **Persisted hydration with a 30-minute TTL**: the call state is written to the panel's
  `localStorage` so closing and reopening the side panel mid-call still shows a live Hangup
  button; per-candidate phone-matching ensures that resurrected state only surfaces on the right
  candidate.

### SMS template manager — `src/components/template-manager.tsx` + `template-editor.tsx`

A self-contained feature surface: storage-backed SMS templates with a dirty-tracking editor, a
picker with variable substitution and a stale-selection guard, confirm-before-send, and
fire-and-forget cloud sync layered over local storage (`useTemplateHydration` does a one-shot
cloud → local seed on first authenticated mount, and only when local is empty). It is the first
feature built end-to-end to the project's "one module owns its UI, its inline styles, and its
own message handlers" convention.

### Background service worker — `src/background/`

The only component that holds the auth token, and the system's gateway to the network.

- **One message handler per file** under `src/background/messages/` (Plasmo auto-routes by
  filename) — each is a thin, typed adapter that calls `authFetch` against one middleware or
  music route and normalizes the response/error envelope for the UI.
- **`authFetch`** (`auth-runtime.ts`) attaches `Authorization: Bearer …`, sets JSON content
  type, and **transparently retries once** when a `401` body signals `auth_jwt_invalid` —
  refreshing the token first.
- **A URL watcher** listens to `webNavigation` history-state updates (SPA pushState) plus
  full-navigation and tab-switch backstops, and broadcasts `lr-mode-changed` so the panel
  flips between sync and candidate modes as the user navigates LinkedIn.
- **A command relay**: `chrome.commands` fire in the worker, but their actions live in the
  panel DOM, so each command (toggle call / speak candidate name) is relayed verbatim as a
  runtime message the panel handles via `useCommandHotkeys`.
- **Idempotent install/update migrations**: v1 moved the legacy shared secret from
  `chrome.storage.sync` (which silently replicates across every Chrome profile on the same
  Google account — a real cross-machine leak) to `chrome.storage.local`; v2 wipes the now-dead
  `extensionSecret` / `consultantFirstName` / cached identity keys left over from the
  pre-OAuth era, so old installs upgrade cleanly.

### Authentication — `src/auth/` + `src/background/auth-runtime.ts`

The most significant piece of engineering in the repo: a full migration from a per-user shared
secret (`X-Extension-Token`) to **Cloudflare Access SaaS-OIDC + PKCE**.

- **Protocol layer (`oauth.ts`).** A pure `oauth4webapi` wrapper — memoized discovery,
  authorization-URL build (S256 PKCE, `offline_access` scope to obtain a refresh token), code
  exchange with full nonce/audience validation, and refresh. No storage I/O.
- **Lifecycle (`auth-runtime.ts`, background-only).** Sign-in runs through
  `chrome.identity.launchWebAuthFlow` against a redirect URI bound to a **stable extension ID**
  (pinned by `CRX_PUBLIC_KEY`, so the OAuth redirect stays valid across rebuilds). PKCE flight
  state is persisted because the service worker can suspend during the auth window, and is
  re-validated (state match + TTL) on return. **Refresh is serialized behind a single in-flight
  promise** so concurrent calls can't trigger a refresh stampede, with proactive renewal ~30 s
  before access-token expiry.
- **React surface (`AuthProvider.tsx`).** The whole panel is gated behind `<RequireAuth>`. Auth
  state is read reactively from storage; writes go through messages to the worker. React never
  touches the token.

**The hard bug, and the fix.** After cutover, sessions appeared to drop after ~5 minutes. The
refresh machinery was entirely correct — the defect was one predicate: the UI gated "is the
session valid?" on the **access-token** expiry (a deliberately short 5-minute TTL) instead of on
the presence of a **refresh token**. The login screen swapped in before any background handler
could refresh. The fix was to gate `isAuthenticated` on *refreshability* (a stored refresh token
+ no `needs_reconnect` flag), not on access-token lifetime — letting `authFetch` quietly swap a
stale access token for a fresh one on the next call.

### Now-playing music bar — `src/components/music-bar.tsx` + `src/lib/musicRemote.ts`

A persistent now-playing bar that mirrors and remote-controls the music player on the office
TV ([recruit-tv-dashboard](https://github.com/HukijG/recruit-tv-dashboard)) via the backend's
dedicated music worker — HTTP control routes (play/pause/next/prev/volume/search/enqueue/playlists)
plus a WebSocket that streams a now-playing snapshot. The worker's shared Durable Object fans
that snapshot to *every* teammate's extension, so the whole team collaboratively drives one TV. **There is no audio in the extension; it
is a remote and a live display only.** Three problems shaped the design:

- **A browser WebSocket can't send an `Authorization` header** — so it can't carry the Bearer
  token the rest of the extension uses. The solution is **single-use ticket auth**: the bar
  `authFetch`-POSTs for a short-lived ticket over the authed HTTP path, then opens the socket
  with the ticket as a second `Sec-WebSocket-Protocol` value, which the worker redeems before
  accepting the upgrade. A failed ticket fetch is treated exactly like a dropped connection and
  rides the same capped-exponential-backoff reconnect path (no header-less socket is ever
  opened).
- **A 4 Hz progress clock that doesn't re-render the app.** The WS subscription hook owns only
  the raw snapshot + status; a separate `useInterpolatedPosition` hook, run *inside the bar's
  own subtree*, advances the displayed position on a monotonic `performance.now()` clock. The
  snapshot is authoritative on every frame (a backward seek moves the bar back); the per-tick
  clamp keeps only the *interpolation between* frames monotonic. Hoisting the clock up would
  re-render every mode at 4 Hz during playback.
- **Lifecycle as a demand-gate.** The socket opens whenever the panel is open on any non-editor
  surface — the worker's upstream player socket lives exactly while someone has the panel open,
  so gating the connection to a single mode would collapse the gate. A higher overlay (template
  manager, job modal, composer) **suppresses** the bar's chrome rather than tearing it down, so
  a transient blur never destroys a half-typed search. The bar was also rebased off the
  temporary shared secret onto the same Access OAuth token as everything else.

### Mobile companion — `mobile/`

An early-stage Capacitor + Vite + React app that reuses the *same middleware contracts* to offer
a jobs list, a candidate pager, an SMS template manager, and a call stream on a phone. It is an
honest, unshipped proof of concept, scoped as such — see [`mobile/README.md`](mobile/README.md).

---

## Key flows

**Sync (capture → match → push → add to job).**
```
pipeline page → content reads selected rows → side panel scrolls to load all rows
 → side panel re-reads selected rows → user drops native CSV export
 → local normalize + greedy one-to-one match (name + company score)
 → review table (matched / warning / error) → user ticks set
 → POST /candidates (batch upsert)  → optional POST /candidates/add-to-job
```

**Cold call (open candidate → call → track → log).**
```
candidate URL → background broadcasts candidate mode → fetch /candidate-details
 → render identity card + caller-ID picker + recent activity
 → POST /dialpad-call (with opaque caller-ID alias)
 → poll /extension-call-status @500ms → calling → active → ended
 → hangup / mark-invalid (deferred + undo) / send templated SMS
```

**Auth (sign-in → use → refresh).**
```
sign-in: launchWebAuthFlow → PKCE code exchange → store {access, refresh, expiry} in worker
use:     authFetch attaches Bearer; near-expiry → proactive refresh (promise-locked)
401 auth_jwt_invalid → refresh once → retry; refresh fails → wipe session + needs_reconnect
React:   reactively reads session presence; gates on refreshability, never on access-token TTL
```

**Music WS (ticket → upgrade → stream).**
```
panel open → authFetch POST /music/ws-ticket → open WS with subprotocols
 ['rf-music.v1', 'ticket.<id>'] → worker redeems ticket → snapshots stream in
 → bar interpolates position locally @4Hz; drop → capped backoff reconnect
```

---

## Hard problems, decisions & trade-offs

| Problem | Decision | Why |
|---------|----------|-----|
| Native CRM extension mis-resolved public profiles | Read the public URL from the user's own native CSV export and merge locally | The reliable identifier already exists in the export; no internal-reference resolution, lower risk, ToS-aware |
| Secrets in the browser | Zero-secrets client; Workers own keys; identifiers aliased to opaque tokens | A leaked client can't call anything; raw caller IDs/numbers never sit client-side |
| Per-user shared secret was weak and replicated across profiles | Re-architect to Cloudflare Access SaaS-OIDC + PKCE; token background-only | Real SSO identity, refreshable sessions, no long-lived secret in storage |
| "5-minute logout" after OAuth cutover | Gate UI auth on *refreshability*, not access-token expiry | The short access-token TTL is by design; the refresh token defines the session window |
| Refresh stampedes under concurrent calls | Serialize refresh behind one in-flight promise + proactive renewal | Rotating refresh tokens mean concurrent refreshes corrupt each other |
| Live call state over SSE was fragile across reloads/SPA nav | Reverse to 500 ms polling with watchdog + persisted hydration | The simpler mechanism survived all three failure modes the stream didn't |
| Browser WebSocket can't send auth headers | Single-use ticket minted over authed HTTP, redeemed at upgrade | The only header-free way to authenticate a browser WS to the worker |
| A 4 Hz playback clock would re-render the whole app | Interpolate position inside the bar subtree only; snapshot stays authoritative | Keeps the music feature's high-frequency clock from leaking app-wide |
| Out-of-order candidate fetches | Monotonic request token; drop stale responses; nothing cached across candidates | Navigating fast must never show a previous candidate's data |

---

## Backend contract surface — the integration seam

The extension is the thin client of a **distributed system that lives in
[recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend)**: five Cloudflare
Workers with Durable Objects for strong consistency, Workers-AI transcript classification, an
MCP server for AI-assistant access, and 1,553 automated tests against the real Workers
runtime. All business logic, state management, and automated testing live there. Two of those
workers serve this extension: the **main worker** (every candidate/call/SMS/stats/template
route below) and the **music worker** (whose downstream is the office-TV kiosk,
[recruit-tv-dashboard](https://github.com/HukijG/recruit-tv-dashboard) — that repo's
[demo video](https://github.com/HukijG/recruit-tv-dashboard/blob/dev/docs/media/extension-remote-demo.mp4)
shows this side panel driving the TV). The extension imports no backend code — only the
shapes below. (The three-repo picture is [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md).)

| Route (middleware) | Used for |
|--------------------|----------|
| `POST /candidates` | Batch upsert of synced candidates into the CRM |
| `POST /candidates/add-to-job` | Add the new records to a chosen job |
| `POST /candidate-details` | Candidate-mode data: RF id, phone, picked job, recent activity |
| `POST /candidate-mark-invalid` | Tag a candidate's number invalid (idempotent) |
| `POST /dialpad-user-context` | Caller-ID picker options (opaque aliases, no raw E.164) |
| `POST /dialpad-call` / `/dialpad-hangup` | Initiate / terminate a Dialpad call |
| `POST /dialpad-sms` | Send a templated SMS |
| `POST /extension-call-status` | Polled ~every 500 ms for live call state |
| `POST /call-stats` | The consultant's daily call counter |
| `GET/PUT/DELETE /sms-templates[/{id}]` | Cloud-synced SMS templates (JWT-scoped) |

| Route (music worker) | Used for |
|----------------------|----------|
| `POST /music/{play,pause,resume,next,prev,volume,search,enqueue,…}` | Remote control of the office player |
| `POST /music/ws-ticket` | Mint a single-use ticket for the now-playing socket |
| `WS /music/now-playing` | Live now-playing snapshot stream |

Both Workers sit behind the same Cloudflare Access OAuth application; every request above is sent
with the background worker's Bearer token (the WebSocket via the ticket exchange).

---

## Configuration & build

The extension is a pnpm-managed project; the [`mobile/`](mobile/README.md) companion is a
separate npm project. Build-time configuration is supplied through environment files —
copy [`.env.example`](.env.example) to `.env.development` (for `plasmo dev`) and
`.env.production` (for `plasmo build`). The real env files are gitignored.

Required variables (full origins, no trailing slash):

| Variable | Purpose |
|----------|---------|
| `PLASMO_PUBLIC_MIDDLEWARE_URL`     | The Cloudflare Worker that fronts Recruiterflow + Dialpad. |
| `PLASMO_PUBLIC_MUSIC_URL`          | The dedicated music-remote Worker (HTTP control + now-playing WebSocket). |
| `PLASMO_PUBLIC_ACCESS_TEAM_DOMAIN` | Cloudflare Access tenant. |
| `PLASMO_PUBLIC_ACCESS_CLIENT_ID`   | OAuth client ID for the Access application. |
| `CRX_PUBLIC_KEY`                   | Base64 public key that pins a stable extension ID (so the OAuth redirect URI stays valid across rebuilds). |

The manifest pins its host permissions and connect-src CSP to those origins (plus `wss:` for the
socket), and drops the broad `<all_urls>` / `tabs` / `scripting` permissions in favour of the
minimal `sidePanel` / `storage` / `webNavigation` / `identity` set.

```bash
pnpm install

pnpm dev        # Plasmo dev build; load build/chrome-mv3-dev as an unpacked extension
pnpm build      # Production build (a prebuild step fails fast if env vars are missing)
pnpm package    # Zip the production build for distribution

npx tsc --noEmit   # The project's "compiles cleanly" check
```

---

## Repository layout

```
.
├── src/                      Extension source
│   ├── sidepanel.tsx         Orchestrator: global CSS + mode routing + cross-mode state
│   ├── content.ts            Thin LinkedIn-page DOM reader (no UI, no logic)
│   ├── auth/                 Cloudflare Access OAuth (PKCE) client + React provider
│   ├── background/           Service worker
│   │   ├── auth-runtime.ts   Token storage, promise-locked refresh, authFetch
│   │   └── messages/         One backend message handler per file
│   ├── components/           One module per feature surface (sync, candidate, music-bar, templates…)
│   └── lib/                  Shared types, nullable contexts, hooks, formatters, constants
├── mobile/                   Early-stage Capacitor mobile companion (separate npm project)
├── assets/                   Extension icon
├── docs/
│   └── PROJECT_HISTORY.md    The dated development history (read this for "why")
├── .env.example              Required build-time environment variables
├── CLAUDE.md                 Binding coding conventions + the frontend design system
├── NOTICE.md                 Source-available notice
└── package.json              Scripts, deps, and the MV3 manifest block
```

---

## Documentation

This README is the headline architectural document. The deeper reference docs remain the
exhaustive source and are worth reading for the full reasoning:

- [`docs/PROJECT_HISTORY.md`](docs/PROJECT_HISTORY.md) — the dated development history, commit
  hashes as receipts: the sync problem, hardening for distribution, the cold-call cockpit, the
  SMS templates, the shared-secret → OAuth re-architecture, and the cross-repo music bar.
- [`CLAUDE.md`](CLAUDE.md) — the binding coding conventions: project structure, the
  context-gating pattern, and the frontend design system (typography, spacing, palette).
- [`mobile/README.md`](mobile/README.md) — the early-stage mobile companion.
- [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) — how this extension, the edge backend, and the office TV form one system.
- [`docs/chrome-web-store-audit.md`](docs/chrome-web-store-audit.md) — the Chrome Web Store / ToS readiness audit: permissions, data handling, and why the design stays on the right side of both.


---

## Scope — what the extension does *not* do

- It does **not** inject UI into LinkedIn's page DOM (it uses the Side Panel API).
- It does **not** call LinkedIn's API or resolve internal talent references to public profiles
  by following redirects — the public URL comes from the user's own CSV export.
- It does **not** hold any third-party API keys; all CRM / dialer / music access is brokered by
  the Cloudflare Workers.
- It does **not** create CRM / dialer records itself — that is the middleware's job.
- It does **not** play audio (the music bar is a remote and a live display only).
- It does **not** handle downstream enrichment.

---

## Status

The extension is the primary, complete portfolio piece. The [`mobile/`](mobile/README.md)
companion is an early-stage proof of concept and has not shipped. The backend Workers live in
[recruit-edge-backend](https://github.com/HukijG/recruit-edge-backend) and are not vendored
here; this repo defines only the client side and the contracts it depends on — so the public
build performs no data acquisition on its own.
