#!/usr/bin/env node

/**
 * apply-body.js
 *
 * Updates email body HTML in Customer.io via browser automation (Puppeteer).
 * The Customer.io App API does not support updating the `body` field for emails
 * created with the drag-and-drop editor, so we automate the UI instead.
 *
 * Usage:
 *   node scripts/apply-body.js templates/ca-245-trial-ends-soon.yaml
 *   node scripts/apply-body.js templates/ca-*.yaml          # glob for bulk
 *   node scripts/apply-body.js --all                        # all campaign action templates
 *
 * Env vars:
 *   CIO_WORKSPACE_ID  - Customer.io workspace ID (default: 136877)
 *   CIO_BASE_URL      - Customer.io base URL (default: https://fly.customer.io)
 *
 * Prerequisites:
 *   - npm install puppeteer (or add to package.json)
 *   - Chrome must be running with remote debugging enabled:
 *       /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *   - You must be logged into Customer.io in that Chrome instance
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const puppeteer = require("puppeteer");
const glob = require("glob");

const WORKSPACE_ID = process.env.CIO_WORKSPACE_ID || "136877";
const BASE_URL = process.env.CIO_BASE_URL || "https://fly.customer.io";

function resolveFiles(args) {
  if (args.includes("--all")) {
    return glob.sync(
      path.join(__dirname, "..", "templates", "ca-*.yaml")
    );
  }
  const files = [];
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const matches = glob.sync(arg);
    if (matches.length > 0) {
      files.push(...matches);
    } else if (fs.existsSync(arg)) {
      files.push(arg);
    } else {
      console.warn(`Warning: ${arg} not found, skipping`);
    }
  }
  return files;
}

function loadTemplate(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const template = yaml.load(raw);
  if (!template || !template.id || !template.type) {
    throw new Error(`Invalid template YAML: ${filePath}`);
  }
  return template;
}

function actionUrl(template) {
  return `${BASE_URL}/workspaces/${WORKSPACE_ID}/journeys/composer/actions/${template.id}`;
}

async function connectBrowser() {
  try {
    const browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      defaultViewport: null,
    });
    console.log("Connected to Chrome via remote debugging.");
    return browser;
  } catch (err) {
    console.error(
      "\nCould not connect to Chrome. Make sure Chrome is running with remote debugging:\n" +
        "\n  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n" +
        "\nAnd that you are logged into Customer.io.\n"
    );
    throw err;
  }
}

async function waitForEditor(page) {
  // Wait for the Customer.io editor to fully load
  await page.waitForSelector('[data-testid="email-editor"], .ProseMirror, .ace_editor, .CodeMirror, iframe[title]', {
    timeout: 15000,
  });
  // Give the editor a moment to initialize
  await new Promise((r) => setTimeout(r, 2000));
}

async function switchToCodeEditor(page) {
  // Look for a "Code" tab or "Edit HTML" button to switch to the code editor
  const switched = await page.evaluate(() => {
    // Try various selectors that Customer.io might use for the code editor toggle
    const selectors = [
      'button[aria-label="Code"]',
      'button[data-testid="code-editor-tab"]',
      '[role="tab"]:has-text("Code")',
      'button:has-text("Code")',
      'a:has-text("Code")',
      '[data-testid="html-editor-toggle"]',
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return sel;
        }
      } catch (e) {
        // querySelector doesn't support :has-text, try text matching
      }
    }

    // Fallback: find buttons/tabs by text content
    const buttons = document.querySelectorAll('button, [role="tab"], a');
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === "code" || text === "html" || text === "edit html" || text === "source") {
        btn.click();
        return `text:${text}`;
      }
    }
    return null;
  });

  if (switched) {
    console.log(`  Switched to code editor via: ${switched}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return switched;
}

async function updateBodyInEditor(page, bodyHtml) {
  // Strategy 1: Try CodeMirror editor
  const codeMirror = await page.evaluate((html) => {
    const cm = document.querySelector(".CodeMirror");
    if (cm && cm.CodeMirror) {
      cm.CodeMirror.setValue(html);
      return "codemirror";
    }
    return null;
  }, bodyHtml);
  if (codeMirror) return codeMirror;

  // Strategy 2: Try Ace editor
  const ace = await page.evaluate((html) => {
    const aceEl = document.querySelector(".ace_editor");
    if (aceEl && window.ace) {
      const editor = window.ace.edit(aceEl);
      editor.setValue(html, -1);
      return "ace";
    }
    return null;
  }, bodyHtml);
  if (ace) return ace;

  // Strategy 3: Try Monaco editor
  const monaco = await page.evaluate((html) => {
    if (window.monaco) {
      const editors = window.monaco.editor.getEditors();
      if (editors.length > 0) {
        editors[0].setValue(html);
        return "monaco";
      }
    }
    return null;
  }, bodyHtml);
  if (monaco) return monaco;

  // Strategy 4: Try textarea or contenteditable
  const textarea = await page.evaluate((html) => {
    // Look for a textarea with HTML content
    const textareas = document.querySelectorAll("textarea");
    for (const ta of textareas) {
      if (ta.value.includes("<!DOCTYPE") || ta.value.includes("<html") || ta.value.includes("<body")) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value"
        ).set;
        nativeInputValueSetter.call(ta, html);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        return "textarea";
      }
    }
    return null;
  }, bodyHtml);
  if (textarea) return textarea;

  // Strategy 5: Try ProseMirror (for rich-text, less likely for HTML source)
  // This is a fallback - we'd need to inject HTML differently
  return null;
}

async function clickSave(page) {
  const saved = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (
        text === "save" ||
        text === "save changes" ||
        text === "save & close" ||
        text === "update" ||
        text === "done"
      ) {
        btn.click();
        return text;
      }
    }
    return null;
  });
  if (saved) {
    console.log(`  Clicked "${saved}" button`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return saved;
}

async function applyBodyToAction(page, template) {
  if (!template.body_html) {
    console.log(`  Skipping ${template.name} — no body_html in template`);
    return false;
  }

  const url = actionUrl(template);
  console.log(`  Navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  await waitForEditor(page);

  // Try to switch to code/HTML editor
  await switchToCodeEditor(page);

  // Update the body HTML
  const method = await updateBodyInEditor(page, template.body_html);
  if (!method) {
    console.error(
      `  Could not find a code editor to update. You may need to manually switch this email to the code editor in Customer.io first.`
    );
    return false;
  }
  console.log(`  Updated body HTML via ${method} editor`);

  // Save
  const saveResult = await clickSave(page);
  if (!saveResult) {
    console.warn(
      `  Could not find a save button — you may need to save manually (Cmd+S)`
    );
  }

  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node scripts/apply-body.js templates/<file>.yaml [...]  or  --all"
    );
    process.exit(1);
  }

  const files = resolveFiles(args);
  if (files.length === 0) {
    console.error("No template files found.");
    process.exit(1);
  }

  // Filter to campaign actions only (newsletters use different UI)
  const templates = files
    .map((f) => ({ file: f, template: loadTemplate(f) }))
    .filter(({ template }) => template.type === "campaign_action");

  if (templates.length === 0) {
    console.error("No campaign action templates found in the provided files.");
    process.exit(1);
  }

  console.log(`\nApplying body HTML for ${templates.length} template(s):\n`);
  templates.forEach(({ template }) =>
    console.log(`  - ca-${template.id}: ${template.name}`)
  );
  console.log();

  const browser = await connectBrowser();
  const page = await browser.newPage();

  let success = 0;
  let failed = 0;

  for (const { file, template } of templates) {
    console.log(`\n[ca-${template.id}] ${template.name}`);
    try {
      const ok = await applyBodyToAction(page, template);
      if (ok) success++;
      else failed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  await page.close();
  browser.disconnect();

  console.log(`\nDone. ${success} succeeded, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
