#!/usr/bin/env node

/**
 * apply-body-clipboard.js
 *
 * A lightweight alternative to apply-body.js that doesn't need Puppeteer.
 * For each template, it:
 *   1. Copies the body HTML to your clipboard
 *   2. Opens the Customer.io editor in your default browser
 *   3. Waits for you to paste and save, then moves to the next template
 *
 * Usage:
 *   node scripts/apply-body-clipboard.js templates/ca-245-trial-ends-soon.yaml
 *   node scripts/apply-body-clipboard.js --all
 *
 * Env vars:
 *   CIO_WORKSPACE_ID  - Customer.io workspace ID (default: 136877)
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { execSync } = require("child_process");
const readline = require("readline");

const WORKSPACE_ID = process.env.CIO_WORKSPACE_ID || "136877";
const BASE_URL = "https://fly.customer.io";

function resolveFiles(args) {
  if (args.includes("--all")) {
    const dir = path.join(__dirname, "..", "templates");
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("ca-") && f.endsWith(".yaml"))
      .map((f) => path.join(dir, f));
  }
  return args.filter((a) => !a.startsWith("-") && fs.existsSync(a));
}

function loadTemplate(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return yaml.load(raw);
}

function copyToClipboard(text) {
  execSync("pbcopy", { input: text });
}

function openUrl(url) {
  execSync(`open "${url}"`);
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node scripts/apply-body-clipboard.js templates/<file>.yaml [...]  or  --all"
    );
    process.exit(1);
  }

  const files = resolveFiles(args);
  const templates = files
    .map((f) => ({ file: f, template: loadTemplate(f) }))
    .filter(({ template }) => template.type === "campaign_action" && template.body_html);

  if (templates.length === 0) {
    console.error("No campaign action templates with body_html found.");
    process.exit(1);
  }

  console.log(`\nFound ${templates.length} template(s) to update:\n`);
  templates.forEach(({ template }) =>
    console.log(`  - ca-${template.id}: ${template.name}`)
  );

  for (let i = 0; i < templates.length; i++) {
    const { template } = templates[i];
    const url = `${BASE_URL}/workspaces/${WORKSPACE_ID}/journeys/composer/actions/${template.id}`;

    console.log(`\n[${ i + 1}/${templates.length}] ca-${template.id}: ${template.name}`);
    console.log(`  URL: ${url}`);

    // Copy body HTML to clipboard
    copyToClipboard(template.body_html);
    console.log(`  Body HTML copied to clipboard (${template.body_html.length} chars)`);

    // Open in browser
    openUrl(url);
    console.log("  Opened in browser.");
    console.log("\n  Steps:");
    console.log("    1. Switch to the Code/HTML editor if not already there");
    console.log("    2. Select all (Cmd+A) and paste (Cmd+V)");
    console.log("    3. Save (Cmd+S or click Save)");

    if (i < templates.length - 1) {
      await prompt("\n  Press Enter when done to continue to the next template...");
    } else {
      await prompt("\n  Press Enter when done...");
    }
  }

  console.log(`\nAll ${templates.length} template(s) processed.\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
