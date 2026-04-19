# ronapplier

Ron's personal resume page + job-application drafting pipeline.

## What it does

- **Resume page** (`/`) — renders `data/resume.json` as a clean, readable page.
- **Apply helper** (`/apply.html`) — paste one job description, get a tailored cover letter + short hiring-manager outreach email, both grounded in the real resume.
- **Batch pipeline** (`npm run process`) — drop job URLs into `data/jobs.txt`, the CLI fetches each page, extracts the job description with Claude, drafts materials, and logs each one to the tracker. Re-running skips already-processed URLs.
- **Application tracker** — `data/applications.json` is the source of truth. Every logged app shows up on `/apply.html` with a "View drafts" toggle to copy the cover letter + email.

Ron hits **submit** on the real application form himself — the tool handles the tedious part (fetch → extract → tailor → stash).

## Run

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start          # web UI at http://localhost:3000
npm run process    # batch-process data/jobs.txt
```

## Batch workflow

1. Open `data/jobs.txt`, paste one job URL per line (direct posting URLs work best — Greenhouse, Lever, Ashby, company careers pages).
2. Run `npm run process`.
3. Open `/apply.html`. Each new job appears in the tracker with its cover letter + outreach email ready to copy.

**Notes on URLs:** LinkedIn and Indeed often return a login wall for unauthenticated fetches. If the CLI reports "likely a login wall", grab the direct posting URL (most listings link out to the company's ATS) and try that instead.

## Files

- `server.js` — Express server (resume, draft, applications APIs).
- `lib/drafter.js` — shared Claude calls (`extractJob`, `draftMaterials`).
- `lib/htmlToText.js` — HTML stripper used by the CLI.
- `scripts/process-jobs.js` — batch URL processor.
- `data/resume.json` — canonical resume.
- `data/jobs.txt` — URL list (one per line, `#` comments allowed).
- `data/applications.json` — logged applications + stored drafts.
- `public/` — static frontend.
