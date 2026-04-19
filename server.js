const express = require("express");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const RESUME_PATH = path.join(DATA_DIR, "resume.json");
const APPLICATIONS_PATH = path.join(DATA_DIR, "applications.json");

const resume = JSON.parse(fs.readFileSync(RESUME_PATH, "utf8"));
const resumeText = buildResumeText(resume);

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
  fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify(all, null, 2));
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

  const client = new Anthropic();

  const systemPrompt = [
    "You help Ron Kovacs draft tailored job application materials.",
    "Ground every claim in his real resume — do not invent employers, titles, technologies, dates, or outcomes he does not have.",
    "If the job asks for experience Ron does not have, acknowledge it honestly or omit it rather than fabricate.",
    "",
    "RESUME (authoritative source of truth for Ron's experience):",
    resumeText,
  ].join("\n");

  const userPrompt = buildUserPrompt({
    company,
    role,
    jobDescription,
    hiringManager,
    extraContext,
  });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const { coverLetter, outreachEmail } = splitDraft(text);

    res.json({
      coverLetter,
      outreachEmail,
      raw: text,
      usage: response.usage,
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

function buildResumeText(r) {
  const lines = [];
  lines.push(`${r.name} — ${r.title}`);
  lines.push(`${r.location} | ${r.phone} | ${r.email}`);
  lines.push("");
  lines.push("SUMMARY");
  lines.push(r.summary);
  lines.push("");
  lines.push("SKILLS");
  for (const [group, items] of Object.entries(r.skills)) {
    lines.push(`- ${group}: ${items.join(", ")}`);
  }
  lines.push("");
  lines.push("EXPERIENCE");
  for (const job of r.experience) {
    lines.push(`${job.title} — ${job.company} (${job.location}) | ${job.dates}`);
    for (const b of job.bullets) lines.push(`  - ${b}`);
    lines.push("");
  }
  lines.push("EDUCATION");
  for (const e of r.education) {
    lines.push(`${e.degree}, ${e.school} (${e.dates})`);
  }
  return lines.join("\n");
}

function buildUserPrompt({ company, role, jobDescription, hiringManager, extraContext }) {
  const parts = [
    `Company: ${company}`,
    `Role: ${role}`,
    hiringManager ? `Hiring manager: ${hiringManager}` : "Hiring manager: unknown",
    extraContext ? `Additional context from Ron: ${extraContext}` : null,
    "",
    "Job description:",
    jobDescription,
    "",
    "Produce two outputs, separated by the exact delimiter lines shown:",
    "",
    "=== COVER LETTER ===",
    "A tailored cover letter (3-4 short paragraphs). Specific, grounded in resume. No fluff, no superlatives like 'best employee you'll ever hire.' Map Ron's real experience to the job's requirements.",
    "",
    "=== OUTREACH EMAIL ===",
    "A short outreach email (under 150 words) to the hiring manager. Friendly, professional, referencing one specific thing about the role. If the hiring manager name is unknown, use 'Hi there,'. End with Ron's name. Do NOT fabricate a mutual connection or a reason you already spoke.",
  ].filter(Boolean);

  return parts.join("\n");
}

function splitDraft(text) {
  const coverMatch = text.match(
    /=== COVER LETTER ===\s*([\s\S]*?)(?:=== OUTREACH EMAIL ===|$)/i,
  );
  const emailMatch = text.match(/=== OUTREACH EMAIL ===\s*([\s\S]*)/i);
  return {
    coverLetter: (coverMatch ? coverMatch[1] : text).trim(),
    outreachEmail: (emailMatch ? emailMatch[1] : "").trim(),
  };
}
