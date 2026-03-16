#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const BASE_URL = "https://api.customer.io/v1";
const API_KEY = process.env.CUSTOMERIO_APP_API_KEY;
const TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");

if (!API_KEY) {
  console.error("Error: CUSTOMERIO_APP_API_KEY environment variable is required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function apiFetch(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`API ${res.status} for ${endpoint}: ${await res.text()}`);
  }
  return res.json();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchAllCampaigns() {
  const data = await apiFetch("/campaigns");
  return data.campaigns || [];
}

async function fetchActionDetail(campaignId, actionId) {
  const data = await apiFetch(`/campaigns/${campaignId}/actions/${actionId}`);
  return data.action || data;
}

async function fetchNewsletterContents(newsletterId) {
  const data = await apiFetch(`/newsletters/${newsletterId}/contents`);
  return data.contents || [];
}

async function fetchAllNewsletters() {
  const data = await apiFetch("/newsletters");
  return data.newsletters || [];
}

function buildCampaignTemplate(action, campaign) {
  return {
    id: Number(action.id),
    campaign_id: campaign.id,
    type: "campaign_action",
    name: action.name || `${campaign.name} - Action ${action.id}`,
    subject: action.subject || "",
    preheader: action.preheader_text || "",
    body_html: action.body || "",
    body_text: action.body_plain || "",
  };
}

function buildNewsletterTemplate(content, newsletter) {
  return {
    id: newsletter.id,
    content_id: content.id,
    type: "newsletter",
    name: content.name || newsletter.name || `Newsletter ${newsletter.id}`,
    subject: content.subject || "",
    preheader: content.preheader_text || "",
    body_html: content.body || "",
    body_text: content.body_plain || "",
  };
}

function writeTemplate(template) {
  const slug = slugify(template.name);
  const prefix = template.type === "newsletter" ? "nl" : "ca";
  const filename = `${prefix}-${template.id}-${slug}.yaml`;
  const filepath = path.join(TEMPLATES_DIR, filename);

  const content = yaml.dump(template, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });

  fs.writeFileSync(filepath, content, "utf8");
  console.log(`  Wrote ${filename}`);
}

async function main() {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

  console.log("Fetching campaigns...");
  const campaigns = await fetchAllCampaigns();
  console.log(`Found ${campaigns.length} campaigns`);

  let templateCount = 0;

  for (const campaign of campaigns) {
    const emailActions = (campaign.actions || []).filter((a) => a.type === "email");

    for (const stub of emailActions) {
      const action = await fetchActionDetail(campaign.id, stub.id);
      const template = buildCampaignTemplate(action, campaign);
      writeTemplate(template);
      templateCount++;
    }
  }

  console.log("\nFetching newsletters...");
  const newsletters = await fetchAllNewsletters();
  console.log(`Found ${newsletters.length} newsletters`);

  for (const newsletter of newsletters) {
    const contents = await fetchNewsletterContents(newsletter.id);
    for (const content of contents) {
      const template = buildNewsletterTemplate(content, newsletter);
      writeTemplate(template);
      templateCount++;
    }
  }

  console.log(`\nExported ${templateCount} templates to ${TEMPLATES_DIR}`);
}

main().catch((err) => {
  console.error("Export failed:", err.message);
  process.exit(1);
});
