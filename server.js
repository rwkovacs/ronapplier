const express = require("express");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;
const { loadResume, draftMaterials } = require("./lib/drafter");
const { autofill, mapFieldsWithClaude, loadProfile } = require("./lib/autofill");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const APPLICATIONS_PATH = path.join(DATA_DIR, "applications.json");

const { resume } = loadResume();

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS — this server is localhost-only; allow the browser extension
// and any local origin to hit it.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/resume", (_req, res) => {
  res.json(resume);
});

app.get("/api/applications", (_req, res) => {
  res.json(readApplications());
});

app.post("/api/applications", (req, res) => {
  const { company, role, jobUrl, hiringManager, notes } = req.body || {};
  if (!company || !role) {
    return res.status(400).json({ error: "company and role are required" });
  }
  const entry = {
    id: `app_${Date.now()}`,
    createdAt: new Date().toISOString(),
    company,
    role,
    jobUrl: jobUrl || null,
    hiringManager: hiringManager || null,
    notes: notes || null,
    status: "drafted",
  };
  const all = readApplications();
  all.unshift(entry);
  writeApplications(all);
  res.json(entry);
});

app.post("/api/draft", async (req, res) => {
  const { company, role, jobDescription, hiringManager, extraContext } =
    req.body || {};

  if (!company || !role || !jobDescription) {
    return res
      .status(400)
      .json({ error: "company, role, and jobDescription are required" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set. Export it in your shell before starting the server.",
    });
  }

  try {
    const result = await draftMaterials({
      company,
      role,
      jobDescription,
      hiringManager,
      extraContext,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return res
        .status(err.status || 500)
        .json({ error: err.message, type: err.constructor.name });
    }
    console.error(err);
    res
      .status(500)
      .json({ error: String(err && err.message ? err.message : err) });
  }
});

app.post("/api/autofill", async (req, res) => {
  const { applicationId, url, autoSubmit } = req.body || {};
  if (!applicationId && !url) {
    return res.status(400).json({ error: "applicationId or url is required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
  }

  let target = url;
  let jobContext = null;
  if (applicationId) {
    const app = readApplications().find((a) => a.id === applicationId);
    if (!app) return res.status(404).json({ error: "application not found" });
    if (!app.jobUrl) return res.status(400).json({ error: "application has no jobUrl" });
    target = app.jobUrl;
    jobContext = {
      company: app.company,
      role: app.role,
      jobDescription: app.jobDescription,
    };
  }

  // Launch browser async — respond immediately so the UI doesn't hang.
  // The browser window stays open for Ron to review and submit manually.
  autofill({ url: target, jobContext, headless: false, autoSubmit: !!autoSubmit })
    .then((result) => {
      console.log(
        `autofill done: ${result.filled}/${result.total || "?"} (${result.platform})`,
      );
    })
    .catch((err) => {
      console.error("autofill error:", err.message);
    });

  res.json({ launched: true, url: target });
});

// Used by the browser extension: given the form fields it scraped from
// the current page, return a list of { afId, value } mappings.
app.post("/api/autofill-fields", async (req, res) => {
  const { fields, jobContext } = req.body || {};
  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: "fields array is required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
  }
  try {
    const profile = loadProfile();
    const { resume: r } = loadResume();
    const fills = await mapFieldsWithClaude({
      fields,
      profile,
      resume: r,
      jobContext: jobContext || null,
    });
    res.json({
      fills: fills.map(({ afId, value }) => ({ afId, value })),
      count: fills.length,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return res
        .status(err.status || 500)
        .json({ error: err.message, type: err.constructor.name });
    }
    console.error(err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// Serve the resume PDF so the extension can attach it to file inputs.
app.get("/api/resume.pdf", (_req, res) => {
  const profile = loadProfile();
  const p = path.resolve(DATA_DIR, "..", profile.resumePath || "");
  if (!profile.resumePath || !fs.existsSync(p)) {
    return res.status(404).json({ error: "no resume PDF at profile.resumePath" });
  }
  res.sendFile(p);
});

// Expose the minimal profile bits the extension needs (no secrets).
app.get("/api/profile", (_req, res) => {
  res.json(loadProfile());
});

app.listen(PORT, () => {
  console.log(`ronapplier listening on http://localhost:${PORT}`);
});

function readApplications() {
  try {
    return JSON.parse(fs.readFileSync(APPLICATIONS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeApplications(apps) {
  fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(apps, null, 2));
}
