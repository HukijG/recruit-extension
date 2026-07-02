# Project History — how recruit-extension was built

A dated, in-order account of how this extension actually came together: the sync
tool it started as, the cold-call cockpit it grew into, the security
re-architecture that replaced its auth wholesale, the cross-repo music remote, and
the reversals and dead ends along the way.

The extension is the thin client of a larger system. Almost every hard decision
here comes back to one constraint: the people using it are recruiters mid-call, on
LinkedIn, with no patience for a tool that is slow, breaks, or needs explaining.
Everything had to be fast, durable, and effortless or it would simply go unused —
which is why the client is deliberately dumb about secrets and state, and the
weight lives server-side. The current architecture is described in the
[`README.md`](../README.md); this document is the "how it got there."

The history is essentially linear — a single continuous commit stream to `main`
with one genuine parallel branch (the OAuth work, reconciled by an explicit merge).
Dates below are commit dates.

---

## April 2026 — the founding shape: a thin sync client

**2026-04-02** — The initial commit `77427c3` lands the whole first idea in one
shot: a Plasmo-based Manifest V3 extension that reads candidate rows off a LinkedIn
Recruiter pipeline page and POSTs them to a Cloudflare Worker. Even at day one the
founding shape is the one that survives to the end — a thin client whose only jobs
are DOM extraction and an authenticated relay to the worker. It ships with lazy-load
scroll handling to force LinkedIn to render its virtualised rows, CSV matching to
recover each candidate's public profile URL, candidate send with
created/updated/skipped/error status, job assignment through a fuzzy-search modal, a
full state reset, and a single shared "extension secret" carried in an
`X-Extension-Token` header as the only auth. At this point it is still called, and
framed as, a "scraper."

The core product insight is already in place: the one field that makes a reliable
CRM match — the candidate's *public* profile URL — is present in LinkedIn
Recruiter's own native CSV export, so the extension merges the user's own export
against the on-page rows locally rather than resolving internal references. The
native CRM extension that was supposed to handle this misidentified profiles
(especially candidates with hidden or abbreviated surnames) and lagged a roughly
two-hour webhook delay; this replaced it.

**2026-04-28** — After nearly four weeks of quiet following the initial burst, the
first real bug — and the first appearance of a discipline that recurs for the rest of
the project. Pressing Scrape on page N+1 of a paginated
pipeline, without a full panel remount, carried stale transient state — matched
candidates, send results, jobs, modal flags — over from page N `06904ba`. The
fix was a full reset of transient state before each run plus a manual Reset button,
folded in with three scroll-loop correctness fixes: a synchronous `scrollTo(0,0)`,
removal of an `alreadyPopulated` shortcut that let stale rows skip the scroll cycle,
and a false-stall fix on iteration 0. The commit is explicit that all of it is
zero-cost on the happy path — the typical ~1.5-second scrape time was preserved.
"Thin client, but the state machine still has to be bulletproof, and it must stay
fast" is the through-line that starts here.

---

## Late April 2026 — hardening for distribution, and retiring "scraper"

Before the tool could be handed to a team, it went through a formal readiness pass
— as much a real security review as a store-policy one. This is the
[`docs/chrome-web-store-audit.md`](chrome-web-store-audit.md) work.

**2026-04-29** — The audit and design spec came first, scoped explicitly to not touch
functionality `08559a4`. It was then sharpened through an external review pass and
worked up into an implementation plan: the review documented a Plasmo manifest
env-var-omission behaviour, moved the storage migration into `onInstalled` to kill a
race, wrapped that migration in try/catch so a failure could not false-flag as done,
and strengthened the verification steps (assert the exact `host_permissions` count,
cross-tab navigation test, grep every log site). The plan left each task in a working
state — sideload plus manifest inspection is the project's manual-testing convention
throughout. Then the scope grew once the terminology problem turned out to run deeper
than copy: internal identifiers (`ScrapedCandidate`, `scrapeCandidate`, the
`"scraping"`/`"scraped"` state values) and more user-visible strings were pulled in,
the plan gained a task, and the final verification step became a grep that had to
return zero matches for the string "scrap." The decision to retire "scraper" as a
concept was driven by store-policy optics around LinkedIn scraping, not a technical
need.

**2026-04-29** — The plan then executes task by task across ten commits `7aac365`
→ `7640555`:

- `.env` scaffolding and gitignoring the npm lockfile / tsbuildinfo `7aac365`.
- The rename to **Recruiter Pipeline Sync 1.0.0** plus trimming unused manifest
  permissions `e0d4bb7`.
- A genuine credential fix: the shared secret was moved from `chrome.storage.sync`
  to `chrome.storage.local` with an install/update migration `ca8852f`
  `405742c`. `storage.sync` silently replicates across every Chrome profile on
  the same Google account — a real cross-machine leak, not just a review flag.
- The middleware URL pinned via a `PLASMO_PUBLIC_MIDDLEWARE_URL` env var with a
  prebuild guard, dropping the old user-configurable URL field `df4395a`
  `fb33c53` `d7acb7e`.
- PII stripped from console logs, down to counts and indices `bd208e3`.
- The scrape→sync/candidate/load rename across both user-visible copy and internal
  terminology `e697569` `7640555`.

---

## Late April 2026 — the cold-call cockpit is born

**2026-04-30** — The biggest product turn began with a design spec and a fifteen-task
implementation plan for a second mode. Whenever a LinkedIn Recruiter candidate
side panel is open, the extension auto-switches into a cockpit view — auto-fetches
the CRM record, shows a Dialpad call link, and offers a deferred "Number Invalid"
action. The plan also introduces a persistent `consultantFirstName` field sent on
every middleware request (including the existing sync routes) so calls could be
attributed per user.

The build-out runs the same day, in ordered layers `34b5e76` → `d7de577`: a
URL-mode-detection helper; the `webNavigation` permission; a background watcher
broadcasting `lr-mode-changed`; a `getActiveTabContext` message to seed the mode; a
bounded-retry DOM read of the open profile URL; `fetchCandidateDetails` and
`markNumberInvalid` message handlers; `consultantFirstName` wired onto the candidate
routes; and a `ConsultantNameHeader` component.

The UI follows `7074d5f` → `05b4b76`: mode state that pauses sync-polling
while in candidate mode; a race-safe candidate state machine with loading/error UI;
the phone rendered as a Dialpad link (disabled fallback when absent); a job box and
a chronological cold-call list; and the "Number Invalid" button with its deferred
POST and undo toast.

**2026-04-30** — Two bugs caught after the build, both invisible because the UI hid
them `9572763`. A deferred mark-invalid POST resolving *after* the user switched
candidates correctly dropped its state update via a `urlId` guard — but the global
error toast still fired over the *new* candidate's view; fixed by gating the toast
behind the same `urlId` match. And the tab-events listener kept firing `pollPageInfo`
regardless of mode, churning sync state even while candidate mode hid it; folded
into the polling effect so it only registers in sync mode.

**2026-04-30** — A visual pass on the pre-sync landing state `3932594` →
`b0d91b9`: the consultant name moved from a corner pill to an inline hero
greeting with edit-in-place, a wave emoji and animated accents, a CSS-only
"select profiles" micro-interaction with a `prefers-reduced-motion` override, and
spacing tuning — craftsmanship rather than architecture.

**2026-04-30** — A candidate-view polish commit carried a real platform-quirk
discovery `dad8e46`: a `dialpad://` protocol link inside the Chrome side panel
silently did nothing, because **the side panel drops top-level navigation to
non-http URL schemes** (and a hidden iframe inherits the same restriction). The fix
was to open the URL via `chrome.tabs.create` with auto-close, giving Chrome's normal
navigator a shot at the custom scheme and surfacing its native "Open Dialpad?"
prompt.

---

## 1 May 2026 — one very dense day: middleware calling, a refactor, SMS templates, and a rule

Almost everything in this section happened on a single day. It is the day the
project stopped being a sync tool with a call link and became a real calling
surface — and the day its conventions got written down.

**Routing calls through the middleware.** The raw `dialpad://` launcher was replaced
outright with a middleware-routed call flow `11f1e5f`. The extension now POSTs to
the worker, which holds the Dialpad API key and the real device IDs and phone
numbers server-side; the client never sees them. The rationale is stated directly in
the commit: keep credentials off the client. It also records a discovered API
constraint — Dialpad's `initiate_call` has no `device_id` parameter, so it rings
every eligible client and the human picks up wherever's nearest; there is no device
picker to build. A dev-only mock test-call view was added to exercise the flow
without ringing real people, and the aliased caller-ID payload is cached client-side
for a week against a matching worker-side TTL.

**The single-file structure breaks.** By this point `sidepanel.tsx` had passed 3,500
lines, so it was split into `src/lib/` (types, contexts, formatters, constants) and
per-mode `src/components/`, leaving `sidepanel.tsx` as a ~939-line entry/orchestrator
`b387f33`. The split itself preserved behaviour; the same commit also carried the
first tranche of texting/template-manager UI groundwork on the candidate and test-call
views. This is the first sign of the codebase outgrowing a single file — and it
directly precedes the moment those structural rules were made binding.

**The SMS template manager.** A design spec and a five-phase plan: a compose popover
with confirm-before-send, a full-screen
template-manager overlay, a modal editor with dirty-tracking, and a
`chrome.storage.local` data layer explicitly "shaped for a future remote-sync seam"
(that seam is filled two weeks later — see *May 12–13*). The plan calls for a
code-review checkpoint at the end of each phase. The compose popover shipped first,
with the backend send deliberately deferred to a `console.log` stub `1f1cf33`;
the same commit fixed a cross-platform bug where the flag-emoji prefix in the
caller-ID dropdown fell back to literal "us"/"uk" letters on Chrome/Windows.

**The corrections become a rule.** Around this point the recurring corrections stopped
being repeated ad hoc and hardened into written project conventions — the rules
carried in [`CLAUDE.md`](../CLAUDE.md): the file structure (no feature UI inside
`sidepanel.tsx`), the context-gating pattern for mode-specific UI, frontend design
minimums (≥14px body text, dark text, comfortable padding, modal geometry), and the
verification model (`npx tsc --noEmit`; explicitly no `pnpm build` during dev
iteration). The file exists, in its own framing, so the same things don't have to be
corrected twice. This is the moment a recurring set of corrections became a standing
rule the tooling was expected to follow.

**Executing the SMS plan.** The five phases ran in sequence `c38a685` →
`61b72ad`: storage helpers and an `SmsTemplate` type; a custom `Select`/`Menu`
dropdown replacing the native `<select>` (the caller-ID picker migrated first); the
template-manager overlay; focus-visible rings retrofitted onto the new buttons for
accessibility parity; the dirty-tracking editor with a save confirmation; and the
picker wired with variable substitution and a stale-selection guard. The still-open
pieces — middleware send route, sending/error states, remote sync, production trigger,
multi-variable support — were tracked in the working notes rather than dropped
silently. Five close-reasoned polish
commits followed `ba86c48` → `5db2399`, tuning field order, popover heights,
and the integrated edit-pencil control.

**Wiring the send, and how to fail.** The SMS "Yes" confirm was wired to a
`/dialpad-sms` middleware route mirroring the call route `a3d557d`, with async
send state (a "Sending…" phase, disabled buttons, an inline
error that preserves the textarea on failure). Then a deliberate decision about
error UX `d60afdc`: 429 rate-limit responses are handled with a structured
`{error, reason, retryAfterSec}` envelope and a "Try again in Xs" countdown rather
than a status-line string. The stated rationale is that users should be able to retry
quickly on transient errors without being over-alarmed by a banner — don't treat a
recoverable failure like a fatal one.

**Graduating to real candidates.** The provider stack (caller-ID and text contexts)
that had only existed in the dev test-call view was lifted into real candidate mode
so production users got the full Call/Text/Number-Invalid surface `9137779`. The
commit removes the "Open test call view" landing button per an explicit user
request — *"they're using the extension on real candidates from now on."* A clear
operator decision: the feature graduated from internal test-only to live use, and
the test entry point was pulled (the component itself kept for future testing).

**A timing bug from a fast machine.** LinkedIn's candidate side panel hydrates
lazily after a URL change, and the original ~1-second bounded retry was too short on
fast machines that raced ahead of LinkedIn's own render, tripping a false error on
cold-cache loads `8986c79`. The fix switched to a wall-clock 10-second window at
the same 50ms cadence, still returning immediately once the element appears.

**The first SSE experiment.** Live call state — is the call ringing, connected,
ended? — was first built as a server-sent-event stream `08d7538` `5446e72`.
An `EventSource` opens against `/extension-call-stream` once per side-panel mount,
driving an idle/calling/active/ended state machine; the candidate-mode Call button
flips to a red Hangup pill only when the live call's phone matches the current
candidate, with a 15-second silent watchdog reverting to Call if Dialpad never
confirms "active." This design lasted four days — see *May 5*.

---

## Early May 2026 — the SSE reversal, mobile, and calling-state churn

**2026-05-05** — The **SSE → polling reversal** `19c1545`. The middleware retired
the EventSource stream and its Durable-Object/webhook scaffolding in favour of a
polled status endpoint, and the extension followed: it dropped the SSE consumer and
drove the same three-state button off a 500ms POST loop scoped to
`status !== "idle"`, keeping a 10-second watchdog that reverts to Call if discovery
never lands. The public API of the call-state hook was preserved so nothing
downstream had to change, and the superseded SSE design doc was deleted. This is a
genuine architecture reversal landing four days after the SSE version shipped — the
simpler mechanism won on robustness across reloads, tab/app switches, and SPA
navigation. (The decision and its reasoning live on the backend side; this commit is
the extension's evidence of the flip.)

**2026-05-05** — A universal Settings popover behind a gear icon `4f90f22`, for
the consultant name and extension secret, reachable from any mode — previously these
were only editable inline on the sync flow, which left candidate and test-call modes
with no way to change them. It uses a two-stage commit UX: typing mutates draft state
only; Save and discard both require an explicit Yes/No confirm.

**2026-05-05** — A `mobile/` PWA was added for traversing the sourced pipeline from a
phone `b9a3b20`, followed by a small cluster of same-day dev-server fixes to reach
it over Tailscale `2571e4a` → `fe79f9c` — allowing Tailscale magic-DNS hosts,
opening `allowedHosts` to tailnet IPs, pinning the Vite root to `mobile/`, and
exempting mobile HTML from a root ignore rule. It is an
honest, unshipped proof of concept, scoped as such — see
[`mobile/README.md`](../mobile/README.md).

**2026-05-05** — A same-day back-and-forth on the mobile calling-state button
`918df4e` → `cab74ef`: drop the watchdog and keep the button grey until the
call is confirmed `in_progress` → restore a 10-second watchdog with an immediate-poll
kickoff → try an optimistic `calling→active` flip after 2 seconds → revert that same
optimistic flip hours later. The optimistic idea was tried and explicitly rejected
the same day; the watchdog-plus-grey-button approach survived. It is a compact
illustration of why call state has to be exactly right: if the button lies about
whether a call connected, recruiters stop trusting it. The call-stream state was also
persisted across reload and tab/app switch `79dc431`, and a daily-calls badge was
wired to a call-stats endpoint, refreshed on mount, on call, and on a timer
`6d746f2`.

**2026-05-06** — The settings gear and the new daily-calls badge were both
`position: fixed` at the top corners and overlaid mode content, so they were hoisted
into a shared flex header row in document flow at the top of every mode `f8a5941`.
A small layout-architecture correction.

---

## 12–13 May 2026 — the security re-architecture: shared secret → Cloudflare Access OAuth

The most significant piece of engineering in the repo, and the one place a named
branch (`feature/oauth-cf-access`) is a real fork rather than a leftover marker. The
per-user `X-Extension-Token` shared secret was replaced wholesale with a real OAuth
2.1 PKCE flow against **Cloudflare Access** as a public client.

**2026-05-12** — The arc opens with the `oauth4webapi` dependency, the Access env
vars, and the `identity` permission `7dd35c9`. The reasoning behind the flow was
captured in a design spec at the time; the decisions in it are the valuable part:

- The background service worker is the **sole** token holder; popups and content
  scripts never read the token directly, only message the background.
- Careful, explicit reasoning on JWT audience validation: the extension validates
  only what `oauth4webapi` does on the `id_token`, and does **not** decode or
  aud-check the `access_token` itself — that is the middleware's job as resource
  server. The spec flags this as "the security claim most likely to be
  misimplemented."
- A direct operator instruction, quoted in the spec: *"Don't have a popup, on
  unauthenticated just prompt on the flat page with a connect button or log in
  button"* — the login UX was specified by the user, not inferred.
- The identity provider behind the Access app exposes only email (no guaranteed name
  claim), so the client was designed to tolerate email-only display names, with the
  door left open to add a server-side name claim later.

The implementation ran in ordered layers `6de542f` → `6d72236`: storage
types and read-helpers, a display-name resolver, the `oauth4webapi` wrapper
(discovery / code exchange / refresh), a typed error for missing discovery fields,
the v2 migration that wipes the stale `extensionSecret` / `consultantFirstName` /
cached-context keys, the background auth runtime (sign-in/out, refresh-lock,
`authFetch`), the `AuthProvider` / `useAuth` / `RequireAuth` React surface, a
`LoginScreen`, a full settings-popover rewrite ("Signed in as … / Log out"),
wrapping the side panel in `AuthProvider` + `RequireAuth` while dropping the old
secret/name plumbing, and finally swapping every outbound handler onto `authFetch`.
A small correctness fix mid-arc replaced a dangling `.finally` in the refresh lock
(which could throw an unhandled rejection) with an IIFE `e0f7555`.

**2026-05-13** — `extensionSecret` and `consultantFirstName` were removed from React
entirely and the call-stream routed through the background `6798bac` — the final
cutover off the legacy identity plumbing.

**2026-05-13 — the 5-minute-logout bug.** After cutover, sessions appeared to drop
about every five minutes `c99b36d`. The refresh machinery was entirely correct;
the defect was a single predicate. `AuthProvider` gated `isAuthenticated` on the
**access-token** expiry — a deliberately short ~5-minute TTL — so the login screen
swapped in before any background handler could refresh, even though `authFetch` was
already silently swapping stale access tokens for fresh ones under the hood. The fix
was to gate the authenticated predicate on **having a stored refresh token** (and no
`needs_reconnect` flag) rather than on access-token lifetime. The same commit moved
all audience validation server-side (the extension needs only issuer and client_id)
and persisted the last-signed-in email to prefill the OIDC `login_hint`. The
precondition for the whole fix — requesting the `offline_access` scope so Access
actually issues a refresh token — landed just before it `97a6b1c`.

**2026-05-13** — With the auth foundation in place, the SMS templates' deferred
remote-sync seam (specified back on May 1) was filled: fire-and-forget cloud sync
layered over `chrome.storage.local` `15ec29c`. The design rule is stated in the
commit body — local storage stays authoritative for every UI read, cloud sync fires
after each local mutation and never rolls back local state on failure ("local
already reflects user intent and cloud catches up"), and cloud→local hydration is a
one-shot seed-only-if-empty per side-panel open. This offline-first discipline is the
same instinct as the thin-client design, stated as an explicit rule. Call-stats
refresh triggers were also widened to visibility change, tab URL change, and SPA
pushState `ca69a23` `e304337`.

---

## 1–2 June 2026 — the cross-repo music remote

A persistent now-playing bar that mirrors and remote-controls the office TV's music
player through a dedicated Cloudflare music worker — the extension's one genuinely
cross-repo feature. There is no audio in the extension; it is a remote and a live
display only. It was built in strict layers over a single day.

**2026-06-01** — The layers `8168c9d` → `d31a335`: frozen cross-repo
snapshot/search types and a data-only context slot; one background handler per music
endpoint, with the secret carried only as a header, never in URL or body; a WebSocket
hook with 250ms progress interpolation, a monotonic clamp, and reconnect backoff; the
self-contained bar plus its search overlay as their own feature module; and mounting
it as base-page chrome, with its height reserved via a CSS var and toasts floated
above it.

Then a run of same-day correctness and contract passes:

- Parsing was reconciled against the dashboard's real wire shapes (numeric load-id as
  a JS number, artists as a string array, nullable art normalised to empty string),
  and the cross-repo mismatches it couldn't resolve alone were flagged as open
  contract gaps rather than guessed at `dbea525`.
- All music handlers were repointed at the dedicated music worker — separate from the
  Recruiterflow/Dialpad middleware — and the worker's authoritative position kept on
  every re-anchor so backward seeks display correctly `ea1bae3`.
- The remote was conformed to the frozen contract `f497ed2`: a `coerceTrackId`
  helper so numeric Deezer ids reach the wire correctly while the bar keeps string
  ids for React identity, and the bar broadened to run on every non-editor surface.
- The volume control, which that same pass had put a `{ delta }` body on the extension
  side, was reversed hours later to send `{ direction }` `eb74343` once the worker
  and dashboard were confirmed to own the ±10-point magnitude server-side — a same-day
  cross-repo contract renegotiation.
- The reconnect-backoff reset was moved off the bare `ws.onopen` event onto the first
  *successfully-parsed* snapshot `f77eb5d` — otherwise a worker that accepts the
  upgrade and then immediately closes (an auth rejection) caused a tight reconnect
  loop at the 1-second floor.
- **The WebSocket auth problem, and its resolution** `1cd083f`. A browser
  WebSocket cannot set request headers, so it cannot carry the `X-Extension-Token` the
  rest of the extension still runs on at this point. The solution: a background handler
  mints a single-use ticket
  over the authed HTTP path, and the socket opens with that ticket as a
  `Sec-WebSocket-Protocol` value, which the worker redeems before accepting the
  upgrade. A failed ticket mint is treated as a connection failure and rides the same
  backoff path — a header-less socket is never opened.
- Search/playlist/contents endpoints were switched from a POST-with-JSON-body to GET
  with query params, because the worker serves them as idempotent GETs and returned
  405 otherwise `15df48e`.

**2026-06-02** — The bar was redesigned from a flat bottom bar into an upward-growing
bottom sheet `ae5a8b6` — collapsed it shows only art, a marquee title/artist, the
transport, and an expand chevron; volume and search move into the sheet. Two layout
bugs surfaced same-day: a leftover `flex: 1 1 0` from the old horizontal layout let
the search input eat the whole sheet and squash the album art `240bfcf`, and the
art frame stretched horizontally on wide sheets until size was driven from height via
`aspect-ratio: 1/1` `aa02c62`.

**2026-06-02 — the merge that made OAuth shared infrastructure.** The OAuth
re-architecture and the music bar had been developed on parallel branches, and here
they were reconciled with a genuine two-parent merge and real per-file conflict
resolution `6567d82`: keep the OAuth `AuthProvider`/`RequireAuth` shell and the
secret/name-plumbing removal, then graft in the music bar's context provider, hook,
and popover-suppression flag; union the prebuild env checks and manifest permissions;
keep both env blocks. The stated reason is to integrate Cloudflare Access OAuth
*underneath* the bar so the bar's auth could move off its temporary
`X-Extension-Token` secret onto the shared Access token — which the next commit did
`d59d96d`. Every `/music/*` handler moved onto `authFetch`, and the commit notes
the worker itself needed no code change, only the Access secrets set on the deployed
worker to flip its auth gate off the legacy path. This is the dual-auth design from
the May OAuth spec paying off across two independently-deployed workers. That merge
effectively completed the music remote — the extension's history then goes quiet for
roughly four weeks.

---

## Late June 2026 — cold-call outcomes and hotkeys

After the gap, a short, precise pass on the cold-call surface.

**2026-06-29** — A `cancelled` cold-call outcome was added (rang, never connected —
no voicemail, no conversation) to the candidate activity list, with a
reached/cancelled split sub-line and a distinct hollow-ring visual `1102f18`. A
same-day refinement moved the split onto the heading row, renamed "reached" to
"completed" to avoid clashing with the "Connected" label, switched the list to
newest-first while keeping chronological numbering, and flattened a grey-on-grey
colour split `123b9ff`. The commit notes the layout was "verified in-browser
(computed styles + bounding boxes) at 320/360/400px panel widths" — a concrete
instance of a layout claim being checked rather than assumed.

**2026-06-29** — Native `chrome.commands` keyboard shortcuts (call toggle, speak the
candidate's name via `speechSynthesis`) were added `4809b33`, formalising
shortcuts that had previously been hand-patched into the unpacked build on the work
machine — an ad hoc local workaround turned into a proper shipped feature. Because
the commands fire in the service worker but their actions live in the panel DOM, each
command is relayed verbatim as a runtime message the panel handles.

---

## Reflection

Read start to end, the shape of the work is consistent. A feature would begin as a
spec and a plan — often prompted by a real desk problem or an operator instruction
quoted directly in the commit history — get built in ordered layers, hit a concrete
wall (a Chrome side-panel scheme restriction, a fast machine racing LinkedIn's
hydration, a five-minute logout, a header-less WebSocket), and get resolved by
narrowing to the mechanism that actually held up in daily use. Two decisions were
reversed outright — SSE for call state, and the optimistic calling-state flip — both
within days, both because the simpler or more honest behaviour served the user
better. The conventions that started as repeated corrections became a written rule in
`CLAUDE.md`, and the OAuth work was deliberately built as shared infrastructure two
features could stand on.

The constants never moved: the browser holds no third-party credential, nothing is
injected into LinkedIn's own page, and the client stays thin while the durable state
lives server-side. That last one is not gold-plating — it is the adoption
requirement. The people who use this are recruiters in the middle of a call, and a
tool that is slow, unreliable, or fiddly is a tool they quietly stop opening.
