const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Anthropic = require("@anthropic-ai/sdk").default;
const { loadResume } = require("./drafter");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROFILE_PATH = path.join(DATA_DIR, "profile.json");

function loadProfile() {
  return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("greenhouse.io") || u.includes("boards.greenhouse")) return "greenhouse";
  if (u.includes("lever.co") || u.includes("jobs.lever.co")) return "lever";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("myworkdayjobs.com") || u.includes("workday")) return "workday";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("smartrecruiters.com")) return "smartrecruiters";
  return "generic";
}

async function autofill({ url, jobContext, headless = false, autoSubmit = false }) {
  const profile = loadProfile();
  const { resume } = loadResume();
  const platform = detectPlatform(url);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const log = [];
  const record = (msg) => {
    log.push(msg);
    console.log(`  ${msg}`);
  };

  try {
    record(`platform=${platform}`);
    record(`navigating: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Some platforms land on a job view with an Apply button that opens
    // the form. Try to click it if present.
    await maybeClickApply(page, record);

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Upload resume first (often required before other fields become valid)
    await tryResumeUpload(page, profile, record);

    // Snapshot the form, let Claude map fields → values
    const fields = await extractFormFields(page);
    record(`found ${fields.length} fillable field(s)`);

    if (fields.length === 0) {
      record("no form fields detected — leaving browser open for manual review");
      return { platform, filled: 0, log, browser, page };
    }

    const mapping = await mapFieldsWithClaude({
      fields,
      profile,
      resume,
      jobContext,
    });

    let filled = 0;
    for (const item of mapping) {
      try {
        const ok = await applyFieldValue(page, fields, item);
        if (ok) {
          filled++;
          record(`filled: ${item.label || item.selector} = ${truncate(item.value)}`);
        } else {
          record(`skip (no match): ${item.label || item.selector}`);
        }
      } catch (err) {
        record(`error on ${item.label || item.selector}: ${err.message}`);
      }
    }

    if (autoSubmit) {
      record("auto-submit enabled — clicking submit");
      await clickSubmit(page, record);
    } else {
      record("form filled — review and submit manually in the browser window");
    }

    return { platform, filled, total: fields.length, log, browser, page };
  } catch (err) {
    record(`fatal: ${err.message}`);
    throw err;
  }
}

async function maybeClickApply(page, record) {
  const candidates = [
    'a:has-text("Apply for this job")',
    'a:has-text("Apply now")',
    'button:has-text("Apply now")',
    'a:has-text("Apply")',
    'button:has-text("Apply")',
  ];
  for (const sel of candidates) {
    const el = await page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      record(`clicking apply: ${sel}`);
      await el.click().catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function tryResumeUpload(page, profile, record) {
  const resumePath = path.resolve(
    path.dirname(PROFILE_PATH),
    "..",
    profile.resumePath || "",
  );
  if (!profile.resumePath || !fs.existsSync(resumePath)) {
    record("no resume PDF found — set profile.resumePath and place the file");
    return false;
  }
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const name = (await input.getAttribute("name")) || "";
    const id = (await input.getAttribute("id")) || "";
    const accept = (await input.getAttribute("accept")) || "";
    const hay = `${name} ${id} ${accept}`.toLowerCase();
    if (hay.includes("resume") || hay.includes("cv") || accept.includes("pdf")) {
      await input.setInputFiles(resumePath).catch(() => {});
      record(`uploaded resume → ${name || id || "file input"}`);
      return true;
    }
  }
  return false;
}

async function extractFormFields(page) {
  return await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const controls = document.querySelectorAll("input, select, textarea");

    const labelFor = (el) => {
      if (el.labels && el.labels.length) {
        return Array.from(el.labels)
          .map((l) => l.innerText.trim())
          .filter(Boolean)
          .join(" ");
      }
      if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
      if (el.getAttribute("aria-labelledby")) {
        const ids = el.getAttribute("aria-labelledby").split(/\s+/);
        return ids
          .map((id) => document.getElementById(id)?.innerText?.trim())
          .filter(Boolean)
          .join(" ");
      }
      if (el.placeholder) return el.placeholder;
      const wrap = el.closest("label");
      if (wrap) return wrap.innerText.trim();
      return "";
    };

    let idx = 0;
    for (const el of controls) {
      if (el.disabled) continue;
      if (el.type === "hidden") continue;
      if (el.type === "submit" || el.type === "button" || el.type === "reset") continue;
      if (el.type === "file") continue; // handled separately
      if (!el.offsetParent && el.type !== "radio" && el.type !== "checkbox") continue;

      const sel = `__af_${idx}`;
      el.setAttribute("data-af-id", sel);
      idx++;

      const entry = {
        afId: sel,
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        label: labelFor(el),
        required: el.required || el.getAttribute("aria-required") === "true",
      };

      if (el.tagName === "SELECT") {
        entry.options = Array.from(el.options).map((o) => ({
          value: o.value,
          text: o.text,
        }));
      }

      if (el.type === "radio" || el.type === "checkbox") {
        const group = el.name || "";
        const groupKey = `${el.type}:${group}`;
        const existing = out.find((x) => x.groupKey === groupKey);
        if (existing) {
          existing.options.push({ afId: sel, value: el.value, text: labelFor(el) });
          continue;
        }
        entry.groupKey = groupKey;
        entry.options = [{ afId: sel, value: el.value, text: labelFor(el) }];
        entry.label = entry.label || group;
      }

      if (seen.has(entry.afId)) continue;
      seen.add(entry.afId);
      out.push(entry);
    }
    return out;
  });
}

async function mapFieldsWithClaude({ fields, profile, resume, jobContext }) {
  const client = new Anthropic();
  const system = [
    "You map job-application form fields to values from a candidate's profile and resume.",
    "Rules:",
    "- For each field, return the value to fill. For radio/checkbox/select, return the exact option text or value.",
    "- If a field asks something not in the profile, return null (do not fabricate).",
    "- Work-authorization and EEOC questions: answer from profile.workAuthorization and profile.eeoc exactly.",
    "- Do not invent salary, dates, or experience not in the resume.",
    "- For 'Why do you want to work here' / 'Why this role' free-text questions, write a short (under 120 words), specific, grounded answer based on the JD and resume.",
    "- Return STRICT JSON, no prose, no markdown fences.",
    "",
    "Candidate profile:",
    JSON.stringify(profile, null, 2),
    "",
    "Resume:",
    JSON.stringify(resume, null, 2),
    jobContext
      ? "\nJob context:\n" + JSON.stringify(jobContext, null, 2)
      : "",
  ].join("\n");

  const user = [
    "Form fields (afId is the unique ID to reference in your response):",
    JSON.stringify(fields, null, 2),
    "",
    "Return JSON of the form:",
    '{ "fills": [ { "afId": "__af_0", "value": "..." }, ... ] }',
    "",
    "For radio/checkbox groups, value should be the option text that matches the intended answer.",
    "Omit fields you cannot answer rather than guessing.",
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = safeParseJson(text);
  if (!parsed || !Array.isArray(parsed.fills)) return [];

  return parsed.fills
    .filter((f) => f && f.afId && f.value != null && f.value !== "")
    .map((f) => {
      const field = fields.find((x) => x.afId === f.afId);
      return field ? { ...f, label: field.label, field } : null;
    })
    .filter(Boolean);
}

async function applyFieldValue(page, fields, item) {
  const field = item.field;
  const selector = `[data-af-id="${field.afId}"]`;

  if (field.tag === "select") {
    const opts = field.options || [];
    const match = matchOption(opts, item.value);
    if (!match) return false;
    await page.selectOption(selector, match.value).catch(() => {});
    return true;
  }

  if (field.type === "radio" || field.type === "checkbox") {
    const opts = field.options || [];
    const match = matchOption(opts, item.value);
    if (!match) return false;
    await page.locator(`[data-af-id="${match.afId}"]`).check({ force: true }).catch(() => {});
    return true;
  }

  if (field.tag === "textarea" || field.tag === "input") {
    const el = page.locator(selector);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.fill(String(item.value)).catch(async () => {
      await el.click({ force: true }).catch(() => {});
      await el.type(String(item.value), { delay: 10 }).catch(() => {});
    });
    return true;
  }

  return false;
}

function matchOption(opts, value) {
  const v = String(value).toLowerCase().trim();
  return (
    opts.find((o) => (o.value || "").toLowerCase() === v) ||
    opts.find((o) => (o.text || "").toLowerCase() === v) ||
    opts.find((o) => (o.text || "").toLowerCase().includes(v)) ||
    opts.find((o) => v.includes((o.text || "").toLowerCase())) ||
    null
  );
}

async function clickSubmit(page, record) {
  const candidates = [
    'button:has-text("Submit application")',
    'button:has-text("Submit")',
    'input[type="submit"]',
    'button[type="submit"]',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      record(`clicked: ${sel}`);
      return true;
    }
  }
  record("could not find submit button");
  return false;
}

function truncate(s, n = 60) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
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

module.exports = { autofill, detectPlatform, loadProfile };
