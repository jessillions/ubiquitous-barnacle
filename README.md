# Customer.io Template GitOps

Manage Customer.io email template content as version-controlled YAML files. Changes merged to `main` are automatically pushed to Customer.io via GitHub Actions.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set your Customer.io App API key:
   ```bash
   export CUSTOMERIO_APP_API_KEY=your-key-here
   ```
   Find or create your App API key in **Customer.io > Settings > API Credentials**.

3. Add `CUSTOMERIO_APP_API_KEY` as a GitHub Actions secret under **Settings > Secrets and variables > Actions**.

## Usage

### Export templates from Customer.io

Pull all email templates (campaign actions and newsletters) into the `templates/` directory:

```bash
npm run export
```

Each template is saved as a YAML file like `ca-42-welcome-email.yaml` or `nl-7-monthly-digest.yaml`.

### Edit a template

Open any YAML file in `templates/` and modify the fields:

```yaml
id: 42
campaign_id: 5
type: campaign_action
name: Welcome Email
subject: "Welcome to {{customer.first_name}}!"
preheader: "Get started with your account"
body_html: |
  <h1>Welcome!</h1>
  <p>Thanks for signing up.</p>
body_text: |
  Welcome! Thanks for signing up.
```

### Apply a single template manually

```bash
node scripts/apply-template.js templates/ca-42-welcome-email.yaml
```

### Automatic sync on merge

When you merge a PR that changes files in `templates/`, the GitHub Action automatically detects which template files changed and applies only those to Customer.io.

## Workflow

1. Run `npm run export` to pull current templates
2. Commit the YAML files to a branch
3. Edit templates in your editor, open a PR for review
4. Merge to `main` -- the GitHub Action pushes changes to Customer.io

## File format

| Field | Description |
|-------|-------------|
| `id` | Template/action ID in Customer.io (do not change) |
| `campaign_id` | Parent campaign ID (campaign actions only, do not change) |
| `type` | `campaign_action` or `newsletter` (do not change) |
| `name` | Display name |
| `subject` | Email subject line (supports Liquid) |
| `preheader` | Preview text in email clients |
| `body_html` | Full HTML body (supports Liquid) |
| `body_text` | Plain text fallback |

## API

Uses the [Customer.io App API](https://docs.customer.io/integrations/api/app/) at `https://api.customer.io/v1`. Endpoints:

- `GET /campaigns` -- list campaigns
- `GET /campaigns/{id}/actions` -- list email actions per campaign
- `GET /newsletters` -- list newsletters
- `PUT /campaigns/{id}/actions/{action_id}` -- update campaign action
- `PUT /newsletters/{id}` -- update newsletter
