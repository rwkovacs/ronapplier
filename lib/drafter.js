const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;

const DATA_DIR = path.join(__dirname, "..", "data");
const RESUME_PATH = path.join(DATA_DIR, "resume.json");

let cachedResume = null;
let cachedResumeText = null;

function loadResume() {
  if (!cachedResume) {
    cachedResume = JSON.parse(fs.readFileSync(RESUME_PATH, "utf8"));
    cachedResumeText = buildResumeText(cachedResume);
  }
  return { resume: cachedResume, resumeText: cachedResumeText };
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

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in your shell before running.",
    );
  }
  return new Anthropic();
}

async function extractJob(pageText, sourceUrl, client = getClient()) {
  const trimmed = pageText.slice(0, 40000);
  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system:
      "You extract structured job posting data from raw web page text. " +
      "Output ONLY a single JSON object, no prose, no markdown fences. " +
      "If the page does not look like a job posting (login wall, 404, " +
      "captcha, redirect page), return {\"ok\": false, \"reason\": \"...\"}.",
    messages: [
      {
        role: "user",
        content: [
          `Source URL: ${sourceUrl}`,
          "",
          "Raw page text (HTML stripped, may be noisy):",
          "---",
          trimmed,
          "---",
          "",
          "Return JSON with this shape:",
          '{',
          '  "ok": true,',
          '  "company": "<employer name>",',
          '  "role": "<job title>",',
          '  "location": "<location or \'remote\' or null>",',
          '  "jobDescription": "<clean, complete JD including responsibilities and requirements, newlines preserved>"',
          '}',
          "",
          "Rules:",
          "- Do not invent a company name. If not clearly stated, set ok=false.",
          "- jobDescription should be the real posting content, cleaned up — drop nav, cookie banners, 'apply now' buttons, footer text.",
          "- Keep the full JD. Do not summarize.",
        ].join("\n"),
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = safeParseJson(text);
  if (!parsed) return { ok: false, reason: "model did not return valid JSON" };
  return parsed;
}

async function draftMaterials(
  { company, role, jobDescription, hiringManager, extraContext },
  client = getClient(),
) {
  const { resumeText } = loadResume();

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
  return { coverLetter, outreachEmail, raw: text, usage: response.usage };
}

function buildUserPrompt({
  company,
  role,
  jobDescription,
  hiringManager,
  extraContext,
}) {
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

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {}
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

module.exports = {
  loadResume,
  buildResumeText,
  extractJob,
  draftMaterials,
  splitDraft,
};
