# ronapplier

Ron's personal resume page plus an assisted apply helper.

## What it does

- **Resume page** (`/`) — renders `data/resume.json` as a clean, readable page.
- **Apply helper** (`/apply.html`) — paste a job description and get:
  - a tailored cover letter
  - a short outreach email to the hiring manager
  - both grounded in the real resume (the model is instructed not to fabricate experience, titles, tech, or mutual connections)
- **Application tracker** — log each application to `data/applications.json`.

This is an **assistant**, not an auto-applier. Ron reviews every draft before sending.

## Run

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
# open http://localhost:3000
```

## Files

- `server.js` — Express server + `/api/draft` (Claude), `/api/applications`, `/api/resume`.
- `data/resume.json` — canonical resume, source of truth for both the page and the drafter.
- `data/applications.json` — logged applications.
- `public/` — static frontend.
