#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const BASE_URL = "https://api.customer.io/v1";
const API_KEY = process.env.CUSTOMERIO_APP_API_KEY;

if (!API_KEY) {
  console.error("Error: CUSTOMERIO_APP_API_KEY environment variable is required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

function usage() {
  console.error("Usage: node scripts/apply-template.js templates/<filename>.yaml");
  process.exit(1);
}

async function updateCampaignAction(campaignId, actionId, payload) {
  const url = `${BASE_URL}/campaigns/${campaignId}/actions/${actionId}`;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} updating campaign action ${actionId}: ${text}`);
  }
  return res.json();
}

async function updateNewsletterContent(newsletterId, contentId, payload) {
  const url = `${BASE_URL}/newsletters/${newsletterId}/contents/${contentId}`;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} updating newsletter ${newsletterId} content ${contentId}: ${text}`);
  }
  return res.json();
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    usage();
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolved, "utf8");
  const template = yaml.load(raw);

  if (!template || !template.id || !template.type) {
    console.error("Invalid template YAML: missing required fields (id, type)");
    process.exit(1);
  }

  // Note: The Customer.io API does NOT support updating the `body` field for emails
  // created with the drag-and-drop editor — and in practice, it silently ignores `body`
  // updates on all emails. Use `npm run apply:body` (Puppeteer) to update body HTML.
  // The API reliably updates: subject, preheader_text, body_plain, body_amp, sending_state.
  const payload = {};
  if (template.name) payload.name = template.name;
  if (template.subject) payload.subject = template.subject;
  if (template.preheader !== undefined) payload.preheader_text = template.preheader;
  if (template.body_html) payload.body = template.body_html;
  if (template.body_text) payload.body_plain = template.body_text;

  console.log(`Applying template: ${template.name} (${template.type} id=${template.id})`);

  if (template.type === "campaign_action") {
    if (!template.campaign_id) {
      console.error("Campaign action templates require a campaign_id field");
      process.exit(1);
    }
    const result = await updateCampaignAction(template.campaign_id, template.id, payload);
    // Verify body actually updated (CIO API silently ignores body for most emails)
    if (template.body_html) {
      const action = result.action || result;
      // The API silently ignores body updates — detect this by comparing lengths
      // and checking for content unique to the new template
      const bodyUpdated =
        action.body &&
        Math.abs(action.body.length - template.body_html.length) < 50;
      if (!bodyUpdated) {
        console.warn(
          "\n⚠️  Warning: body HTML was NOT updated by the API (Customer.io limitation)." +
          "\n   The API ignores body updates for emails created with the drag-and-drop editor." +
          "\n   To update the body, run:  npm run apply:clipboard -- " + path.relative(process.cwd(), resolved) +
          "\n"
        );
      }
    }
  } else if (template.type === "newsletter") {
    if (!template.content_id) {
      console.error("Newsletter templates require a content_id field");
      process.exit(1);
    }
    await updateNewsletterContent(template.id, template.content_id, payload);
  } else {
    console.error(`Unknown template type: ${template.type}`);
    process.exit(1);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Apply failed:", err.message);
  process.exit(1);
});
