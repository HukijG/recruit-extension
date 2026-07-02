# recruiter-pipeline-mobile

> **Status: experimental / early-stage companion app (v0.0.1, not shipped).**
> This is a secondary, exploratory build — not a finished product. It is kept
> in the repo as a companion proof-of-concept to the Chrome extension, which is
> the primary portfolio piece. Expect rough edges and incomplete flows.

A Capacitor + Vite + React companion mobile app for the LinkedIn Recruiter
extension workflow. It reuses the same Cloudflare middleware contracts as the
extension (Recruiterflow + Dialpad) to provide a small mobile surface for:

- a jobs list,
- a candidate pager,
- an SMS template manager, and
- a Dialpad call stream.

## What's here / not here

- **Here:** the full Vite app source (`src/`), `index.html`, web assets
  (`public/`), and build config (`vite.config.ts`, `tsconfig.json`,
  `capacitor.config.ts`).
- **Not here:** the native `android/` and `ios/` projects. They are
  gitignored and regenerable with `npx cap add android` / `npx cap add ios`
  once you want to produce a native build. None has been shipped.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm run typecheck  # tsc --noEmit
npm run build      # type-check + production web build
```

Configure the backend endpoint via a local `.env` (see `.env.example`). The
real `.env` is gitignored.
