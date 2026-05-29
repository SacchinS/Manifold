# Manifold

Manifold is a CLI tool that lets you ship software through a team of AI agents working asynchronously. You have a planning conversation to define what you want built, approve the plan, and then receive SMS updates as subagents complete each milestone. Reply "approved" via text, the agent merges the PR, and the next milestone begins — all while you're away from your keyboard.

## How it Works

```
manifold run
     │
     ▼
┌─────────────┐
│   Planner   │  ← Conversational Claude agent
│  (planner)  │    defines project + milestones
└──────┬──────┘
       │  plan JSON
       ▼
┌─────────────────────────────────────────────┐
│                Orchestrator                 │
│  for each milestone:                        │
│  1. git checkout -b milestone-N-<name>      │
│  2. Subagent writes code (read/write/bash)  │
│  3. Screenshot (if hasUI)                   │
│  4. git push + gh pr create                 │
│  5. SMS: "PR open at <url>. Reply approved" │
│  6. Wait for SMS reply                      │
│  7. If approved → poll until PR merged      │
│     If feedback → re-run subagent with note │
│  8. git checkout main && continue           │
└─────────────────────────────────────────────┘
       │
       ▼
  🎉 Done
```

## Architecture

```
manifold/
├── bin/
│   └── manifold.js          # CLI entrypoint: manifold run
├── src/
│   ├── planner.js           # Conversational planning agent (Claude)
│   ├── orchestrator.js      # Milestone loop — branches, agents, SMS, PRs
│   ├── subagent.js          # Specialist agents with read/write/bash tools
│   ├── github.js            # Branch, PR creation, merge polling via gh CLI
│   ├── twilio.js            # Send SMS/MMS updates, poll inbox for replies
│   └── screenshot.js        # Playwright screenshot of a running URL
├── webhook-server/
│   └── index.js             # Express server — receives Twilio SMS webhooks
├── inbox.json               # SMS replies land here
└── .env.example             # Environment variable template
```

## Setup

### 1. Clone & install

```bash
git clone git@github.com:SacchinS/Manifold.git
cd Manifold
npm install
npx playwright install chromium
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number (e.g. +15551234567) |
| `MY_PHONE_NUMBER` | Your personal phone number to receive SMS |
| `SCREENSHOT_BASE_URL` | Public base URL for screenshots (your ngrok URL) |
| `WEBHOOK_PORT` | Port for the webhook server (default: 3001) |
| `GITHUB_REPO` | GitHub repo in `owner/repo` format |

### 3. Start the webhook server

In a separate terminal:

```bash
node webhook-server/index.js
```

### 4. Expose the webhook with ngrok

```bash
ngrok http 3001
```

Copy the HTTPS forwarding URL (e.g. `https://abc123.ngrok.io`).

### 5. Configure Twilio

1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Select your Twilio number
3. Under **Messaging → A message comes in**, set the webhook URL to:
   ```
   https://abc123.ngrok.io/webhook
   ```
4. Set `SCREENSHOT_BASE_URL=https://abc123.ngrok.io` in your `.env`

## Usage

```bash
manifold run
```

Manifold will:
1. Start a planning conversation in your terminal
2. Propose a build plan with milestones
3. Ask you to confirm
4. Begin building — one milestone at a time
5. Text you when each milestone is ready for review
6. Continue automatically when you reply "approved"

## Subagent Roster

| Agent | Role |
|---|---|
| `backend-engineer` | Node.js, Express, REST APIs, Claude API |
| `frontend-engineer` | HTML, CSS, vanilla JS or React |
| `database-engineer` | SQLite with better-sqlite3 |
| `test-runner` | Build/lint checks, error fixing |

## Requirements

- Node.js 18+
- GitHub CLI (`gh`) authenticated: `gh auth login`
- Anthropic API key
- Twilio account with a phone number
- ngrok (for SMS webhook)
