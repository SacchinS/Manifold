# Manifold — Build Instructions

You are the orchestrator for a software development team. Your job is to build **Manifold** — a CLI tool that lets users ship software through a team of AI agents working asynchronously. The user has a planning conversation to define what they want built, approves the plan, and then receives SMS/screenshot updates as subagents complete each milestone. The user approves via text, you receive the approval, merge the PR, and continue.

You are building the thing itself.

## Repo
`git@github.com:SacchinS/Manifold.git`

## Golden Rule
After each milestone, open a PR and print the link to the terminal. Poll for the merge before continuing. Do not proceed until the PR is merged.

---

## Workflow Per Milestone

Every milestone follows this exact pattern:

1. `git checkout main && git pull`
2. `git checkout -b milestone-N-<short-description>`
3. Spawn the appropriate subagent(s) with a precise task
4. Subagent does the work and commits to the branch
5. Review the output — files exist, make sense, no obvious errors
6. `git push -u origin milestone-N-<short-description>`
7. `gh pr create --title "Milestone N: <title>" --body "<summary>" --base main --head milestone-N-<short-description>`
8. Print: `"PR #N open: <url> — review and merge when ready."`
9. Poll: `gh pr view <number> --json state --jq '.state'` every 10 seconds until MERGED
10. Continue to next milestone

---

## Project Structure (what you are building)

```
manifold/
├── bin/
│   └── manifold.js          # CLI entrypoint: `manifold run`
├── src/
│   ├── planner.js           # Planning agent — conversational, defines build plan
│   ├── orchestrator.js      # Breaks plan into milestones, spawns subagents
│   ├── subagent.js          # Runs a subagent via Claude API for a given task
│   ├── github.js            # Branch, commit, PR creation, merge polling
│   ├── twilio.js            # Send SMS/MMS updates to user
│   ├── screenshot.js        # Playwright screenshot of a running URL
│   └── inbox.js             # Poll inbox.json for SMS replies
├── webhook-server/
│   └── index.js             # Express server — receives Twilio SMS replies
├── inbox.json               # SMS replies land here
├── .env.example
├── package.json
└── README.md
```

---

## Milestone 1 — Project Scaffold + CLI Entrypoint

**Branch:** `milestone-1-scaffold`

Spawn **infra-engineer**:
- `package.json` — name: manifold, type: module, bin: `{ "manifold": "./bin/manifold.js" }`, dependencies: commander, anthropic, twilio, playwright, express, dotenv, ora, chalk, inquirer
- `bin/manifold.js` — CLI using commander. One command: `manifold run`. Loads `.env`, then calls `src/planner.js`. Mark as executable.
- `.env.example` — ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, MY_PHONE_NUMBER, SCREENSHOT_BASE_URL, WEBHOOK_PORT, GITHUB_REPO (format: owner/repo)
- `.gitignore` — node_modules, .env, inbox.json, screenshots/
- `inbox.json` — `{ "replies": [] }`
- `screenshots/` directory with `.gitkeep`
- Empty `src/` and `webhook-server/` directories

Commit message: `feat: project scaffold and CLI entrypoint`

---

## Milestone 2 — Planning Agent

**Branch:** `milestone-2-planner`

Spawn **backend-engineer**:

Build `src/planner.js` — the conversational planning agent.

- Uses Anthropic SDK (`import Anthropic from '@anthropic/ai'`)
- Model: `claude-sonnet-4-20250514`
- Starts an interactive terminal conversation with the user using inquirer
- System prompt: You are a software planning agent. Help the user define what they want to build. Ask clarifying questions about features, stack preferences, and constraints. Once you have enough information, propose a structured build plan: a list of milestones, each with a title, description, assigned specialist (backend-engineer, frontend-engineer, database-engineer, or test-runner), and whether it will produce a visible UI (for screenshot decisions). Ask the user to confirm the plan before returning it.
- Maintains full conversation history across turns (pass messages array each time)
- Uses `ora` for loading spinner while waiting for Claude response
- Uses `chalk` for formatting (user messages in blue, Claude in green)
- When user confirms the plan, extract and return it as a structured JSON object: `{ projectName, stack, milestones: [{ id, title, description, agent, hasUI }] }`
- Export a default `runPlanner()` async function that returns the plan

Commit message: `feat: planning agent`

---

## Milestone 3 — Subagent Runner

**Branch:** `milestone-3-subagent`

Spawn **backend-engineer**:

Build `src/subagent.js` — runs a specialist subagent via Claude API for a given milestone task.

- Uses Anthropic SDK
- Model: `claude-sonnet-4-20250514`
- Takes `{ milestone, plan, repoPath }` as input
- System prompt per agent type:
  - `backend-engineer`: Expert in Node.js, Express, REST APIs. Write clean, validated, production-quality code. Never expose stack traces.
  - `frontend-engineer`: Expert in HTML, CSS, vanilla JS or React. Clean, responsive UI. Practical design.
  - `database-engineer`: Expert in SQLite (better-sqlite3). Idempotent schemas, prices in cents, realistic seed data.
  - `test-runner`: Run build/lint checks, fix straightforward errors, report pass/fail.
- User prompt: the milestone title + description + full plan context
- Give the subagent access to tools: `read_file`, `write_file`, `run_bash` — implement these as tool definitions using the Anthropic tool use API
- Run the agentic loop: keep calling Claude with tool results until it stops calling tools
- After completion: stage all changes and commit with message `feat: <milestone title>`
- Export default `runSubagent(milestone, plan, repoPath)` async function

Commit message: `feat: subagent runner`

---

## Milestone 4 — GitHub Integration

**Branch:** `milestone-4-github`

Spawn **backend-engineer**:

Build `src/github.js` — handles all git and GitHub operations.

- Uses `gh` CLI via child_process (exec/execSync)
- `createBranch(name)` — `git checkout main && git pull && git checkout -b <name>`
- `pushBranch(name)` — `git push -u origin <name>`
- `openPR(title, body, branch)` — `gh pr create ...`, returns PR number and URL
- `pollUntilMerged(prNumber, intervalMs = 10000)` — polls `gh pr view <prNumber> --json state --jq '.state'` every intervalMs, resolves when state is MERGED
- `mergePR(prNumber)` — `gh pr merge <prNumber> --merge --delete-branch`... actually don't auto-merge. Just poll until the human merges it on GitHub.
- `checkoutMain()` — `git checkout main && git pull`
- All functions return promises, use proper error handling

Commit message: `feat: github integration`

---

## Milestone 5 — Twilio + Webhook Server

**Branch:** `milestone-5-twilio`

Spawn **backend-engineer**:

Build two files:

### `src/twilio.js`
- Uses Twilio SDK
- `sendUpdate(message, screenshotPath?)` — send SMS to MY_PHONE_NUMBER from TWILIO_FROM_NUMBER. If screenshotPath given and SCREENSHOT_BASE_URL set, copy file to `webhook-server/public/`, set mediaUrl.
- `waitForReply()` — poll `inbox.json` every 2 seconds for unread reply. Mark read, return message text. Timeout 30min.
- All config from env vars, clear error messages if missing

### `webhook-server/index.js`
- Express app on WEBHOOK_PORT (default 3001)
- `POST /webhook` — parse Twilio SMS body and from, append to `inbox.json` as `{ timestamp, from, message, read: false }`, return `<Response></Response>`
- `GET /health` — `{ ok: true }`
- `app.use('/screenshots', express.static(path.join(__dirname, 'public')))` — serve screenshots for MMS
- Create `public/` and `inbox.json` on startup if missing
- Log port and ngrok setup instructions on start

Commit message: `feat: twilio integration and webhook server`

---

## Milestone 6 — Screenshot + Orchestrator

**Branch:** `milestone-6-orchestrator`

Spawn **backend-engineer**:

### `src/screenshot.js`
- `takeScreenshot(url, outputPath)` — Playwright Chromium, 1280×800, networkidle, 15s timeout. Create output dir if missing.
- Export as default function

### `src/orchestrator.js`
- Takes the plan returned by `planner.js`
- For each milestone in sequence:
  1. Create branch: `milestone-<id>-<slugified-title>`
  2. Run subagent: `runSubagent(milestone, plan, repoPath)`
  3. If `milestone.hasUI`: start dev server, take screenshot, stop dev server
  4. Push branch, open PR, print link to terminal
  5. Send SMS: `sendUpdate("✅ Milestone <id> done: <title>. PR open at <url>. Reply 'approved' to continue.", screenshotPath?)`
  6. Wait for reply: `waitForReply()`
  7. If reply contains "approved" (case-insensitive): log "Approved. Continuing..." 
  8. Else: log the feedback, re-run the subagent with the feedback appended to the task description, redo from step 3
  9. Poll until PR is merged: `pollUntilMerged(prNumber)`
  10. Checkout main, pull, continue to next milestone
- Export default `runOrchestrator(plan)` async function

Wire everything together in `bin/manifold.js`:
```js
const plan = await runPlanner();
await runOrchestrator(plan);
```

Commit message: `feat: screenshot utility and orchestrator`

---

## Milestone 7 — README + Polish

**Branch:** `milestone-7-readme`

Spawn **backend-engineer** and **technical-writer** in parallel:

**backend-engineer:**
- `npm install`
- `npx playwright install chromium`
- `node --check` all src files
- Fix any import/syntax errors
- Report results

**technical-writer:**
Write `README.md`:
- What Manifold is (the one-paragraph pitch)
- How it works (planning → subagents → SMS approval → merge → repeat)
- Setup: clone, npm install, configure .env, start webhook server, ngrok, Twilio console
- Usage: `manifold run`
- Architecture diagram (ASCII is fine)

Commit message: `docs: readme and integration check`

---

## Subagent Roster

| Agent | Role |
|---|---|
| infra-engineer | Scaffold, config, package.json, directory structure |
| backend-engineer | Node.js modules, Express, Claude API, Twilio, GitHub CLI |
| technical-writer | README, documentation |

---

## Git Rules
- Never commit directly to main
- Always pull main before branching
- Conventional commits: `feat:`, `fix:`, `docs:`
- One PR per milestone

---

## Start
Run `gh auth status` to confirm GitHub CLI is authenticated.
Then begin Milestone 1.
