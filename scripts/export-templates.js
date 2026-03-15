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
  const campaigns = [];
  let hasMore = true;
  let page = 1;
  while (hasMore) {
    const data = await apiFetch(`/campaigns?page=${page}`);
    if (data.campaigns && data.campaigns.length > 0) {
      campaigns.push(...data.campaigns);
      page++;
    } else {
      hasMore = false;
    }
  }
  return campaigns;
}

async function fetchCampaignActions(campaignId) {
  const data = await apiFetch(`/campaigns/${campaignId}/actions`);
  return data.actions || [];
}

async function fetchAllNewsletters() {
  const newsletters = [];
  let hasMore = true;
  let page = 1;
  while (hasMore) {
    const data = await apiFetch(`/newsletters?page=${page}`);
    if (data.newsletters && data.newsletters.length > 0) {
      newsletters.push(...data.newsletters);
      page++;
    } else {
      hasMore = false;
    }
  }
  return newsletters;
}

function extractEmailTemplate(action, campaign) {
  return {
    id: action.id,
    campaign_id: campaign.id,
    type: "campaign_action",
    name: action.name || `${campaign.name} - Action ${action.id}`,
    subject: action.subject || "",
    preheader: action.preheader_text || "",
    body_html: action.body || "",
    body_text: action.body_plain || "",
  };
}

function extractNewsletterTemplate(newsletter) {
  return {
    id: newsletter.id,
    type: "newsletter",
    name: newsletter.name || `Newsletter ${newsletter.id}`,
    subject: newsletter.subject || "",
    preheader: newsletter.preheader_text || "",
    body_html: newsletter.body || "",
    body_text: newsletter.body_plain || "",
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
    const actions = await fetchCampaignActions(campaign.id);
    const emailActions = actions.filter((a) => a.type === "email");

    for (const action of emailActions) {
      const template = extractEmailTemplate(action, campaign);
      if (template.body_html || template.subject) {
        writeTemplate(template);
        templateCount++;
      }
    }
  }

  console.log("\nFetching newsletters...");
  const newsletters = await fetchAllNewsletters();
  console.log(`Found ${newsletters.length} newsletters`);

  for (const newsletter of newsletters) {
    const template = extractNewsletterTemplate(newsletter);
    if (template.body_html || template.subject) {
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
