#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { htmlToText } = require("../lib/htmlToText");
const { extractJob, draftMaterials } = require("../lib/drafter");

const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.txt");
const APPLICATIONS_PATH = path.join(DATA_DIR, "applications.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function main() {
  if (!fs.existsSync(JOBS_PATH)) {
    console.error(`No ${JOBS_PATH}. Create it and add one URL per line.`);
    process.exit(1);
  }

  const urls = fs
    .readFileSync(JOBS_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (!urls.length) {
    console.log("No URLs in data/jobs.txt.");
    return;
  }

  const applications = readApplications();
  const processed = new Set(
    applications.map((a) => a.jobUrl).filter(Boolean),
  );

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of urls) {
    if (processed.has(url)) {
      console.log(`skip (already logged): ${url}`);
      skipped++;
      continue;
    }

    console.log(`\n→ ${url}`);
    try {
      const html = await fetchPage(url);
      const text = htmlToText(html);
      if (text.length < 300) {
        console.warn(
          `  page has ${text.length} chars of text — likely a login wall or redirect. skipping.`,
        );
        failed++;
        continue;
      }

      console.log("  extracting job data…");
      const extracted = await extractJob(text, url);
      if (!extracted.ok) {
        console.warn(`  not a job posting: ${extracted.reason || "unknown"}`);
        failed++;
        continue;
      }
      const { company, role, location, jobDescription } = extracted;
      if (!company || !role || !jobDescription) {
        console.warn(`  extraction missing fields. skipping.`);
        failed++;
        continue;
      }

      console.log(`  drafting: ${company} — ${role}`);
      const { coverLetter, outreachEmail } = await draftMaterials({
        company,
        role,
        jobDescription,
      });

      const entry = {
        id: `app_${Date.now()}`,
        createdAt: new Date().toISOString(),
        company,
        role,
        location: location || null,
        jobUrl: url,
        hiringManager: null,
        notes: null,
        jobDescription,
        coverLetter,
        outreachEmail,
        status: "drafted",
      };
      applications.unshift(entry);
      writeApplications(applications);
      processed.add(url);
      done++;
      console.log(`  ✓ logged ${entry.id}`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\nDone. drafted=${done}, skipped=${skipped}, failed=${failed}, total=${urls.length}`,
  );
}

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": UA,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
