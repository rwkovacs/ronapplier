# ronapplier

Ron's personal resume page + job-application pipeline.

## What it does

- **Resume page** (`/`) — renders `data/resume.json`.
- **Apply helper** (`/apply.html`) — paste a JD, get a tailored cover letter + outreach email.
- **Batch drafting** (`npm run process`) — drop job URLs into `data/jobs.txt`, the CLI fetches each page, extracts the JD with Claude, drafts materials, and logs each job to the tracker.
- **Autofill** (`npm run apply` or "Launch autofill" button) — opens a real Chrome window via Playwright, navigates to the application form, reads the fields, maps them to `data/profile.json` + resume + JD via Claude, and fills them. Ron reviews and clicks submit.

## One-time setup

```bash
npm install
npx playwright install chromium      # downloads the browser Playwright drives
export ANTHROPIC_API_KEY=sk-ant-...
```

Put a PDF of your resume at `data/resume.pdf` (or change `resumePath` in `data/profile.json`). Fill in `linkedin`, `github`, and any other blanks in `data/profile.json`.

## Run

```bash
npm start          # web UI at http://localhost:3000
npm run process    # batch-draft from data/jobs.txt
npm run apply -- <url-or-app-id>    # open browser and autofill
npm run apply -- app_123 --submit   # also click submit (risky — use with care)
```

## End-to-end flow

1. Paste job URLs into `data/jobs.txt` (one per line).
2. `npm run process` — extracts JD, drafts cover letter + outreach email, logs to tracker.
3. `npm start`, open `/apply.html`. Each job has **View drafts** and **Launch autofill** buttons.
4. Click **Launch autofill** → Chrome opens → form fills itself → you review → you click submit.

## ATS coverage

- **Greenhouse, Lever, Ashby** — work well with the generic AI-driven filler.
- **Workday, iCIMS** — best-effort. These are hostile to automation; expect to finish some fields by hand.
- **Anything else** — the generic filler reads labels/placeholders and lets Claude map them to your data.

## Files

- `server.js` — Express server.
- `lib/drafter.js` — JD extraction + cover-letter / outreach drafting (Claude).
- `lib/htmlToText.js` — HTML → text for the batch processor.
- `lib/autofill.js` — Playwright-driven autofill (Claude maps form fields → profile values).
- `scripts/process-jobs.js` — batch URL → draft pipeline.
- `scripts/autofill.js` — autofill CLI.
- `data/resume.json` — canonical resume.
- `data/resume.pdf` — resume PDF for file-upload fields (add this yourself).
- `data/profile.json` — personal details ATSes ask about (work auth, EEOC, links, etc.).
- `data/jobs.txt` — URL list for batch processing.
- `data/applications.json` — logged applications + stored drafts.
- `public/` — static frontend.

## Notes

- The autofill pauses before submit by default — you're the last line of defense against a hallucinated answer or a wrong radio button. Use `--submit` only when you trust the output.
- Claude is instructed not to fabricate experience; if a field asks about something you don't have, it leaves the field blank rather than making something up.
- LinkedIn/Indeed job URLs usually hit login walls when fetched — use the direct ATS link the listing redirects to (Greenhouse/Lever/Ashby/etc.).
