# Chrome Web Store Submission Audit

**Date:** 2026-04-29
**Repo state:** branch `main` @ `bd02093`
**Scope:** policy & technical readiness for a Chrome Web Store **Unlisted** (or **Private**) submission

---

## TL;DR

Nothing in this codebase forces a functionality change to pass review. The extension is in the same product category as Apollo, SourceWhale, Outreach, and the native Recruiterflow extension — a manually-triggered CRM sync over LinkedIn-provided data — and tools in that category live on CWS today.

What's needed before submission is a **pre-submission checklist** of small config/manifest tweaks (drop `<all_urls>`, drop unused permissions, switch storage area from `sync` to `local`, validate HTTPS, bump version, neutral name) plus the standard **listing assets** (icon, screenshots, privacy policy URL, store description). The estimate is roughly half a day of focused work, plus icon design.

The findings are graded:

- **Critical** — would require a functionality change to comply. *(none)*
- **Pre-submission must-fix** — small code/config changes that will be flagged in review.
- **Listing assets** — submission-form fields and visual assets.
- **Hygiene** — quality-of-life improvements, not gating.
- **Business context** — informational; surface decisions for the owner.

A full findings index sits at the end ([§10](#10-findings-index)).

---

## 1. Distribution options compared

Requirement: ~10 internal teammates, non-technical, must auto-update seamlessly.

| Option | Cost | Auto-update | Discovery | User friction | Notes |
|---|---|---|---|---|---|
| **CWS Public** | $5 one-time | Native | Searchable | None | Avoids none of the review work; gains discoverability you don't want |
| **CWS Unlisted** | $5 one-time | Native | Link only | None | Standard recommendation. Same review process as Public ([source 1](#sources)) |
| **CWS Private (Workspace domain)** | $5 + Workspace | Native | Domain users only | None | Best fit if you have a Google Workspace and the admin enables private publishing |
| **CWS Private (Trusted testers)** | $5 one-time | Native | Listed Google accounts | None | Up to ~100 testers by email; works without Workspace |
| **Edge Add-ons** | Free | Native | Public/unlisted | None on Edge | Useful as a parallel distribution if anyone uses Edge |
| **Self-hosted .crx + `update_url`** | Free | Native | None | **High** — Chrome only allows user-installed off-store CRX on **Linux**. On Windows/macOS the only path is Chrome Enterprise force-install policy. ([source 14](#sources)) | Only viable with Chrome management on team devices |
| **Chrome Browser Cloud Management force-install** | Free, Workspace-tier | Native | Forced on org devices | None | Only if team devices are enrolled in your Chrome management |

**Recommended path:** **Unlisted CWS**, or **Private** if a Workspace domain is available. All visibility settings go through identical review; visibility only changes who can find the listing afterwards. ([source 1](#sources))

---

## 2. Manifest & permission audit

Current manifest declared in `package.json:29-41`:

```json
{
  "permissions": ["activeTab", "tabs", "scripting", "sidePanel", "storage"],
  "host_permissions": ["https://www.linkedin.com/talent/*", "<all_urls>"]
}
```

### Per-permission review

| Permission | Used? | Action |
|---|---|---|
| `activeTab` | No `executeScript` calls; no user-gesture-driven access. | **Drop** |
| `tabs` | `chrome.tabs.query` and `tab.url` access in `background/messages/getPageInfo.ts:6,9`. With host_permissions matching `linkedin.com/talent/*`, the `tabs` permission is not strictly required to read `tab.url` for matched URLs. | **Drop & rebuild to confirm.** Re-add only if a check fails. |
| `scripting` | **Zero** `chrome.scripting.*` references in the codebase. The Plasmo `PlasmoCSConfig` declares the content script statically via `content_scripts`. | **Drop** |
| `sidePanel` | Used in `src/background/index.ts:4`. | Keep |
| `storage` | Used by `@plasmohq/storage` (sidepanel `useStorage` hook). | Keep |
| `host_permissions: https://www.linkedin.com/talent/*` | Matches content script. | Keep |
| `host_permissions: <all_urls>` | Carries the user-configured middleware URL fetches. See §2.1. | **Replace** |

### 2.1 `<all_urls>` — small fix, big review impact

Reviewers explicitly look for `<all_urls>` and broad host patterns. Recent removals (April 2025) cite the user-facing "Read and change all your data on all websites" warning ([sources 6, 8, 9](#sources)). It is the most-cited rejection trigger in the troubleshooting docs ([source 6](#sources)).

Two options, both small:

**Option A (recommended): pin the worker host pattern.**
The Cloudflare Worker URL is effectively a constant for your team. Bake it into `host_permissions` and remove the user-configurable URL field from the side panel. Use a Plasmo `PLASMO_PUBLIC_*` env var so dev/prod can differ.

```json
"host_permissions": [
  "https://www.linkedin.com/talent/*",
  "$PLASMO_PUBLIC_MIDDLEWARE_HOST/*"
]
```

```env
# .env.production
PLASMO_PUBLIC_MIDDLEWARE_URL=https://your-worker.workers.dev
PLASMO_PUBLIC_MIDDLEWARE_HOST=https://your-worker.workers.dev
```

In code, `process.env.PLASMO_PUBLIC_MIDDLEWARE_URL` replaces the user-input URL field. The token field stays user-configurable.

**Option B: optional_host_permissions.**
Keep the URL field, declare access at runtime when the user saves the URL:

```json
"optional_host_permissions": ["https://*/*"],
"permissions": ["sidePanel", "storage"]
```
```ts
await chrome.permissions.request({
  origins: [new URL(middlewareUrl).origin + "/*"]
})
```

Reviewers see a much narrower static manifest; the user gets a permission prompt only for the specific URL they configure.

Option A is cleaner for a fixed-team-internal tool; Option B preserves the existing flexibility.

---

## 3. Code-level findings

The implementation is clean by CWS standards. **No** `eval`, `Function()`, `document.write`, dynamic `<script>` injection, `importScripts`, `dangerouslySetInnerHTML`, or remote-code patterns. **No** hardcoded secrets, no telemetry, no analytics, no Sentry. Network calls go to exactly one endpoint. Single purpose is clear.

### 3.1 Storage area — extension secret currently uploaded to Google Sync

**File:** `src/sidepanel.tsx:337-338`

```ts
const [middlewareUrl, setMiddlewareUrl] = useStorage<string>("middlewareUrl", "")
const [extensionSecret, setExtensionSecret] = useStorage<string>("extensionSecret", "")
```

I verified at runtime that `@plasmohq/storage` defaults to `chrome.storage.sync`:

```bash
$ node -e "const s = require('@plasmohq/storage'); console.log(new s.Storage().area)"
sync
```

That means the shared `extensionSecret` gets uploaded to Google's sync servers and replicated to every Chrome profile signed into the same Google account. Reviewers do flag this; it's also a real cross-machine credential leak risk independent of CWS review.

**Fix:** declare a local-only storage instance and pass it into `useStorage`:

```ts
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"

const localStore = new Storage({ area: "local" })

const [middlewareUrl] = useStorage({ key: "middlewareUrl", instance: localStore }, "")
const [extensionSecret] = useStorage({ key: "extensionSecret", instance: localStore }, "")
```

If you take Option A in §2.1 and bake the middleware URL into the build, the `middlewareUrl` storage key goes away entirely — only the secret needs to persist.

### 3.2 Middleware URL not validated as HTTPS

`src/background/messages/sendCandidates.ts:13` and `addToJob.ts:13` accept whatever string the user typed and pass it to `fetch()`. The input element is `type="url"` (`sidepanel.tsx:1106`) but that doesn't enforce HTTPS — a paste of an `http://` URL would send the secret + candidate PII over plaintext.

```ts
function validateMiddlewareUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:") return "Middleware URL must use HTTPS"
    return null
  } catch {
    return "Invalid URL"
  }
}
```

Block save / send when invalid. Moot if you hard-code the worker URL via §2.1 Option A.

### 3.3 PII in console logs

| File | Lines | What gets logged |
|---|---|---|
| `src/content.ts` | 396-405 | Full name + headline + location + industry per scraped candidate |
| `src/sidepanel.tsx` | 223 | Match log: name + CSV name |
| `src/sidepanel.tsx` | 235 | Unmatched candidate name |
| `src/sidepanel.tsx` | 636 | `JSON.stringify(data)` of middleware response — likely contains rfId + candidate metadata |

Console logs are local — this isn't strictly a policy violation, since the user already has the candidate in front of them in Recruiter. But a reviewer who opens DevTools during testing watches PII flow through, and may flag "undisclosed data handling" depending on how strict they are. Cheap to neutralize:

```ts
// content.ts:396 — log a count, not the values
console.log(LOG_PREFIX, "Scraped candidate", {
  experienceCount: experience.length,
  totalExperienceCount,
  educationCount: education.length
})
```

Replace name-containing log lines with neutral identifiers (index, hashed handle).

### 3.4 Inline DOM style injection (cosmetic, not a finding)

`src/sidepanel.tsx:315-320` injects a `<style>` element for the spinner keyframes. Static, no external content, runs in the extension's own document. This is fine. Reviewers occasionally ask about it; cleanest tidy-up is to move keyframes into a CSS module so they're bundled rather than injected at runtime. Not required.

### 3.5 Version bump

`package.json:6` → `"version": "0.1.0"`. CWS accepts any semver, but `0.x` reads as alpha. Bump to `1.0.0` for first submission.

### 3.6 Spec drift (informational)

The original extension spec calls for a separate Options page; the implementation puts URL and secret inputs in the side panel. Not a CWS issue. If you take §2.1 Option A and drop the URL field, this naturally resolves.

---

## 4. Privacy / data-handling

### 4.1 Data the extension touches

| Category | Source | Destination |
|---|---|---|
| Candidate full name | DOM (Recruiter) | middleware |
| Headline / current role | DOM + CSV | middleware |
| Location, industry | DOM | middleware |
| Profile photo URL | DOM | middleware |
| Public LinkedIn profile URL | CSV (Recruiter native export) | middleware |
| Internal LinkedIn talent URL (hashed ID) | DOM | middleware |
| Connection degree, pipeline status | DOM | middleware |
| Work experience (titles, companies, dates) | DOM | middleware |
| Education (institutions, degrees, dates) | DOM | middleware |

This is "personal information" under CWS's User Data policy. The data the user is acting on is data their licensed Recruiter session shows them — equivalent to data the native Recruiterflow extension and other CRM-sync tools handle.

### 4.2 Privacy practices form (what to fill in)

Categories to tick (Google's verbatim PII definition: name, address, telephone, email, identifiers — [source 15](#sources)):

- ☑ **Personally identifiable information** — names, headlines, locations of LinkedIn members
- ☑ **Website content** — Recruiter page DOM
- ☑ **Authentication information** — the X-Extension-Token secret stored in extension storage
- ☐ User activity / web history / personal communications / health / financial / location

Limited Use checkboxes ([source 7](#sources)) — all three should be **checked**:
- ☑ "I do not sell user data"
- ☑ "I do not use or transfer user data for purposes unrelated to my single purpose"
- ☑ "I do not use or transfer user data to determine creditworthiness or for lending purposes"

> **On "selling":** transferring data to your own Cloudflare Worker → Recruiterflow → Dialpad is **not** "selling" in CWS's sense. "Selling" means commercial transfer to data brokers / advertising platforms. First-party CRM and dialer integrations operated by the same business as the user fall under "necessary to providing the single purpose." Disclose those recipients by name in the privacy policy; tick "no" on selling.

### 4.3 Privacy policy URL — required

Required because the extension handles personal data ([source 7](#sources)). Must be hosted at a public URL, accessible to reviewers, and explicitly assert Limited Use compliance.

A skeleton appropriate for this extension is in §9.5 below.

---

## 5. Listing assets & metadata

### 5.1 Icon

`assets/icon.png` is a 512×512 solid blue square (verified). Plasmo derives 16/32/48/128 from this — every size renders as a flat blue square. CWS doesn't have a hard rule against it, but manual reviewers reject low-quality icons under the "represent functionality clearly" guideline. Design a proper icon (a stylized "in"/sync mark, or initials; budget tier — Fiverr or in-house — works fine).

### 5.2 Name — positioning choice

`displayName: "LinkedIn Recruiter Scraper"` carries two avoidable signals:
1. **Trademark in title.** Using "LinkedIn" in the name can imply endorsement; LinkedIn legal does monitor CWS titles for it.
2. **"Scraper" advertises behavior LinkedIn's User Agreement disallows.** This extension isn't a scraper in the prohibited sense (see §6), but the word will read as "this is the thing we ban" to anyone glancing at it.

Cleaner names that reflect what the tool actually does:
- *"Recruiter Pipeline Sync"*
- *"Pipeline → CRM Bridge"*
- *"Recruiterflow Pipeline Importer"*

Not a forced rejection — but you'll be voluntarily importing risk you don't need.

### 5.3 Description

Current: `"Scrapes candidate data from LinkedIn Recruiter pipeline and sends to middleware"`

Reframe around the user benefit and the data path:

> Export selected candidates from your LinkedIn Recruiter pipeline view to your Recruiterflow ATS in one click. Reads candidate fields visible to you on the page, matches them to your CSV export, and posts the result to a configured CRM endpoint.

### 5.4 Screenshots

CWS requires at least one at 1280×800 or 640×400. Three good captures: (a) idle side panel, (b) populated review table after CSV match, (c) "added to job" success state.

### 5.5 Permission justifications

Pre-write these for the submission form:

| Permission | Justification |
|---|---|
| `storage` | Persists the user's middleware authentication token locally on their machine. |
| `sidePanel` | Renders the extension's user interface in Chrome's side panel. |
| `host_permissions: https://www.linkedin.com/talent/*` | Required to read the candidate fields visible to the user on the LinkedIn Recruiter pipeline page they navigate to. |
| `host_permissions: $PLASMO_PUBLIC_MIDDLEWARE_HOST/*` | Required to send the user's selected candidate exports to their company's middleware endpoint, which routes them to their CRM and dialer. |

### 5.6 Single-purpose statement

> The single purpose of this extension is to export the recruiter's selected LinkedIn Recruiter pipeline candidates to their company's CRM via a configured middleware endpoint.

---

## 6. LinkedIn ToS — context, not blocker

This extension is in the **CRM sync tool** category — the same product category as Apollo, SourceWhale, Outreach, and the native Recruiterflow extension. Tools in that category coexist on the Chrome Web Store today.

### What sets this apart from the recently-removed extensions

The LinkedIn extensions removed in April 2025 (`LinkedIn Job Scraper`, `LinkedIn Sales Navigator Scrapper` — [sources 8, 9](#sources)) were doing one or more of:
- Automated/headless enumeration without a user gesture per batch
- Mass crawl across pipelines or search results
- Capturing data the user wouldn't otherwise see in the same session
- Network-layer interception of LinkedIn API calls
- Automated outreach / messaging

This extension does **none** of those:
- Manual trigger per pipeline (user selects → presses sync → confirms)
- Reads only fields already visible on screen in the user's licensed Recruiter session
- Uses LinkedIn's **own** native CSV export for the public profile URL
- No HTTP interception, no LinkedIn API calls, no individual-profile navigation
- Auto-scroll only loads the rows already selected by the user

That puts it in the same generally-accepted gray area as Apollo et al.: not explicitly endorsed by LinkedIn, but a category recruiters depend on and would cancel subs over.

### What's still worth doing

- **Don't advertise the prohibited shape.** Drop "scraper" terminology from the listing, the displayName, and ideally the codebase/UI strings (§5.2-5.3).
- **Keep the manual-trigger design.** Don't bolt on cron/polling/auto-paginate in the future — that's the line.
- **Unlisted distribution.** Reduces the chance LinkedIn legal stumbles onto it via CWS search.
- **Internal-tool framing in the listing description.** Makes the use-case obvious to reviewers and clearly different from the prohibited automation cases.

### What to know but not act on

LinkedIn can complain to CWS regardless of how the extension is framed; LinkedIn can also suspend Recruiter accounts under its ToS. Both are residual risks for any tool in this category. There's no code change here that fully removes them.

---

## 7. Plasmo notes

- `plasmo build` produces minified JS. Minification is **allowed**; obfuscation is not ([source 6](#sources)). Plasmo doesn't obfuscate.
- If you ever hit a "Red Titanium" rejection (suspected obfuscation), rebuild with `plasmo build --no-minify` and resubmit.
- Plasmo's runtime is bundled, not remote-loaded — safe against the "Blue Argon" remote-hosted-code rejection ([source 19](#sources)). Tick "remote code: no" on the privacy form.
- Inspect `build/chrome-mv3-prod/manifest.json` after each build to confirm the generated permissions match what you expect — especially after the §2 changes.
- `plasmo package` produces the .zip ready for CWS upload.

---

## 8. Hygiene (out of scope but worth doing during the same pass)

- No README. Worth one for teammates who clone & sideload during dev.
- No LICENSE.
- `pnpm-lock.yaml` and `package-lock.json` both present — pick one package manager and commit only that lockfile.
- `tsconfig.tsbuildinfo` is untracked but not in `.gitignore`. Add it.
- Development work logs stay out of the repo. Only `src/` ships in the bundle, so this is repo hygiene rather than a CWS concern.

---

## 9. Pre-submission checklist

Roughly half a day of focused work, sequenced smallest → largest. Estimates assume the §2.1 Option A path (pinned worker URL).

### 9.1 Manifest cleanup (~10 min)

```diff
   "manifest": {
     "permissions": [
-      "activeTab",
-      "tabs",
-      "scripting",
       "sidePanel",
       "storage"
     ],
     "host_permissions": [
       "https://www.linkedin.com/talent/*",
-      "<all_urls>"
+      "$PLASMO_PUBLIC_MIDDLEWARE_HOST/*"
     ]
   }
```

Add `.env.production` with the worker URL/host. Re-add `tabs` only if a runtime check fails after rebuild (it almost certainly won't).

### 9.2 Pin middleware URL via env (~30 min)

Replace `useStorage("middlewareUrl", "")` with `process.env.PLASMO_PUBLIC_MIDDLEWARE_URL`. Drop the URL input from the side panel. Token field stays user-configurable.

### 9.3 Storage area → local (~10 min)

Pass `new Storage({ area: "local" })` into the `useStorage` hook for the secret (§3.1).

### 9.4 PII out of console logs (~15 min)

Edit `src/content.ts:396-405` and `src/sidepanel.tsx:223,235,636`. Counts and indices only.

### 9.5 Privacy policy (~1 hour, including hosting it)

Suggested skeleton (host on GitHub Pages, your team site, anywhere publicly reachable):

```markdown
# Privacy Policy — Recruiter Pipeline Sync

Last updated: [date]

## What this extension does
Reads candidate information visible on the user's LinkedIn Recruiter pipeline
page and forwards it to the user's company's configured middleware endpoint
for import into Recruiterflow CRM and Dialpad.

## Data collected
- Candidate full name, headline, location, industry
- Candidate profile photo URL
- Candidate LinkedIn profile URL (from the user's CSV export from LinkedIn
  Recruiter)
- Candidate work experience and education history
- Connection degree and pipeline status

## Where data goes
Data is sent only to the middleware URL configured at build time by the
team's administrator. It is not sent to the extension developer; no
analytics, telemetry, or third-party services are used. The middleware
forwards data to Recruiterflow (CRM) and Dialpad (dialer).

## Data storage
The user's authentication token is stored in `chrome.storage.local` on the
user's device. No candidate data is retained by the extension; it is
forwarded immediately and not cached.

## Limited Use compliance
The extension's use of any data complies with the Chrome Web Store User
Data Policy, including the Limited Use requirements.

## Contact
[your-email]
```

### 9.6 Listing assets (~2 hours)

- Designed icon (512×512 PNG)
- Three 1280×800 screenshots in actual use
- Store description — see §5.3
- Permission justifications — see §5.5
- Single-purpose statement — see §5.6

### 9.7 Rename (~5 min)

Update `displayName`, `description` in `package.json`. Drop "LinkedIn" from the title and "scraper/scrapes" from copy.

### 9.8 Bump version (~2 min)

`0.1.0` → `1.0.0`.

### 9.9 HTTPS validation on the URL (~10 min — skip if §9.2 done)

Per §3.2. Skip if the URL is now build-time-fixed.

### 9.10 Verify and submit (~1 hour)

1. `pnpm build` and inspect `build/chrome-mv3-prod/manifest.json`. Confirm permissions are exactly what you expect.
2. Sideload unpacked, run the full happy path with DevTools open. Confirm no PII logs.
3. `pnpm package` to produce the .zip.
4. Submit as Unlisted (or Private). First-time review usually 1–7 days.

**Total: ~5 hours of focused work**, plus icon design.

---

## 10. Findings index

### Critical (forces a functionality change to comply)

*None.*

### Pre-submission must-fix (small fixes that will be flagged in review)

| # | Finding | Section | Est. |
|---|---|---|---|
| 1 | `<all_urls>` host permission | §2.1 | 30 min |
| 2 | `scripting` permission unused | §2 | 1 min |
| 3 | `tabs` permission likely unused | §2 | 5 min |
| 4 | `activeTab` permission unused | §2 | 1 min |
| 5 | Extension secret stored in `chrome.storage.sync` | §3.1 | 10 min |
| 6 | Middleware URL not validated as HTTPS | §3.2 | 10 min (skip if §2.1A) |
| 7 | Version `0.1.0` → `1.0.0` | §3.5 | 1 min |

### Listing assets (form-fill + visual)

| # | Finding | Section |
|---|---|---|
| 8 | No privacy policy URL | §4.3, §9.5 |
| 9 | Icon is a solid blue square | §5.1 |
| 10 | Name contains "LinkedIn" + "Scraper" | §5.2 |
| 11 | Description uses "scrapes" framing | §5.3 |
| 12 | No screenshots | §5.4 |
| 13 | Permission justifications need writing | §5.5 |
| 14 | Single-purpose statement needs writing | §5.6 |

### Hygiene (not gating)

| # | Finding | Section |
|---|---|---|
| 15 | PII in console logs | §3.3 |
| 16 | Inline `<style>` injection (cosmetic) | §3.4 |
| 17 | Spec drift: options page in spec, side panel in code | §3.6 |
| 18 | No README, LICENSE | §8 |
| 19 | `pnpm-lock.yaml` + `package-lock.json` both present | §8 |
| 20 | `tsconfig.tsbuildinfo` not gitignored | §8 |

### Business context (informational)

| # | Topic | Section |
|---|---|---|
| 21 | LinkedIn ToS positioning — drop "scraper" framing, keep manual-trigger design | §6 |

---

## 11. CWS rejection-code cheat sheet

Reviewers email a code on rejection. Most likely matches if §9 is done:

| Code | Meaning | Trigger here? |
|---|---|---|
| Purple Potassium | Excessive/unjustified permissions | None after §2 |
| Purple Lithium | Missing/inaccessible privacy policy | None after §9.5 |
| Yellow Zinc | Missing/insufficient metadata | None after §9.6 |
| Yellow Magnesium | Functionality not working as described | Possible if reviewer can't reach a Recruiter page; provide a test recording |
| Blue Argon | Remote-hosted code | None — Plasmo bundles |
| Red Titanium | Obfuscated code | None — Plasmo minifies, doesn't obfuscate. `--no-minify` on resubmit if hit |
| Red Nickel/Silicon | Deceptive behavior | Avoid by clear description (§5.3) |

---

## 12. What's clean (no findings)

- No `eval`, `Function()`, dynamic `<script>`, `importScripts`, `dangerouslySetInnerHTML`
- No obfuscated or base64-encoded code
- No hardcoded API keys, tokens, or default credentials
- No third-party analytics, telemetry, or error reporting
- No `chrome.management`, `webRequest`, `cookies`, `history`, or other surveillance-flavored APIs
- No undisclosed network endpoints — exactly one configurable host
- Single purpose is unambiguous
- Manifest V3 native (compliant with the mid-2025 requirement)
- React 18 + Plasmo bundler — well-known, audited toolchain
- Plasmo runtime is bundled, not remote — safe against Blue Argon

After §9 is done, expect this to pass on the first or second submission. The longest delay will be human review of an extension that touches LinkedIn at all, regardless of how it's named.

---

<a id="sources"></a>
## Sources

1. [Chrome Web Store — Set up distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
2. [Chrome Web Store — Enterprise publishing options](https://developer.chrome.com/docs/webstore/cws-enterprise/)
3. [Google Chrome Enterprise — Publishing custom extensions for the enterprise](https://cloud.google.com/blog/products/chrome-enterprise/publishing-extensions-for-the-enterprise)
4. [Chrome Extensions — chrome.tabs API permission requirements](https://developer.chrome.com/docs/extensions/reference/api/tabs)
5. [Chrome Extensions — chrome.scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
6. [Chrome Web Store — Troubleshooting violations](https://developer.chrome.com/docs/webstore/troubleshooting)
7. [Chrome Web Store — Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
8. [chrome-stats.com — LinkedIn Job Scraper (removed 2025-04-20)](https://chrome-stats.com/d/hkljcckjhccibkmcpcjfeeefkppfijeh)
9. [chrome-stats.com — LinkedIn Sales Navigator Scrapper (removed 2025-04-17)](https://chrome-stats.com/d/kpbkpdjplgkhlimbmfodjjlpcnkgjlpc)
10. [Extension Radar — 15 reasons Chrome extensions get rejected](https://www.extensionradar.com/blog/chrome-extension-rejected)
11. [Hacker News — LinkedIn cease and desist for a Chrome extension](https://news.ycombinator.com/item?id=34583932)
12. [LinkedIn Help — Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions)
13. [ProfileSpider — Why Chrome Extensions get blocked on LinkedIn](https://profilespider.com/blog/why-chrome-extensions-get-blocked-on-linkedin)
14. [Chrome Extensions — How to distribute (off-store install: Linux only)](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux)
15. [Chrome Web Store — User Data FAQ (PII definition, secure handling)](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
16. [Chrome Web Store — Review process & timelines](https://developer.chrome.com/docs/webstore/review-process/)
17. [Chrome Web Store — Code Readability policy](https://developer.chrome.com/docs/webstore/program-policies/code-readability)
18. [Chrome Web Store — Privacy fields form](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
19. [Chrome Extensions — Remote-hosted code migration](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
20. [Plasmo Storage README](https://github.com/PlasmoHQ/storage)
