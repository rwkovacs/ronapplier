#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { autofill } = require("../lib/autofill");

const DATA_DIR = path.join(__dirname, "..", "data");
const APPLICATIONS_PATH = path.join(DATA_DIR, "applications.json");

async function main() {
  const args = process.argv.slice(2);
  const autoSubmit = args.includes("--submit");
  const headless = args.includes("--headless");
  const positional = args.filter((a) => !a.startsWith("--"));
  const target = positional[0];

  if (!target) {
    console.error(
      "Usage: npm run apply -- <url|application-id> [--submit] [--headless]",
    );
    process.exit(1);
  }

  let url = target;
  let jobContext = null;

  if (target.startsWith("app_")) {
    const apps = JSON.parse(fs.readFileSync(APPLICATIONS_PATH, "utf8"));
    const app = apps.find((a) => a.id === target);
    if (!app) {
      console.error(`No application with id ${target}`);
      process.exit(1);
    }
    if (!app.jobUrl) {
      console.error(`Application ${target} has no jobUrl`);
      process.exit(1);
    }
    url = app.jobUrl;
    jobContext = {
      company: app.company,
      role: app.role,
      jobDescription: app.jobDescription,
    };
    console.log(`Applying to ${app.company} — ${app.role}`);
  }

  console.log(`\nAutofilling: ${url}`);
  if (autoSubmit) console.log("⚠️  --submit enabled: will click submit after filling");

  const result = await autofill({ url, jobContext, headless, autoSubmit });

  console.log(
    `\n✓ ${result.filled}/${result.total || "?"} fields filled (platform=${result.platform})`,
  );

  if (!autoSubmit) {
    console.log(
      "\nBrowser window is open. Review the form, then click submit manually.",
    );
    console.log("Press Ctrl+C here when you're done to close the browser.");
    await new Promise(() => {}); // keep process alive
  } else {
    await result.browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
