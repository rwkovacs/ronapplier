const express = require("express");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;
const { loadResume, draftMaterials } = require("./lib/drafter");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const APPLICATIONS_PATH = path.join(DATA_DIR, "applications.json");

const { resume } = loadResume();

const app = express();
app.use(express.json({ limit: "1mb" }));
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
