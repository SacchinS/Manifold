import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec, spawn } from 'child_process';
import readline from 'readline';
import runSubagent from './subagent.js';
import { createBranch, pushBranch, openPR, pollUntilMerged, checkoutMain } from './github.js';
import { sendUpdate, waitForReply } from './twilio.js';
import takeScreenshot from './screenshot.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_PATH = path.resolve(__dirname, '..');

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function askTerminal(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function startDevServer(repoPath) {
  const cmdParts = (process.env.DEV_SERVER_COMMAND || 'npm run dev').split(' ');
  const server = spawn(cmdParts[0], cmdParts.slice(1), {
    cwd: repoPath,
    stdio: 'pipe',
    detached: false,
  });
  // Give the server time to boot before screenshotting
  await new Promise(resolve => setTimeout(resolve, 4000));
  return server;
}

function stopDevServer(server) {
  try {
    server.kill('SIGTERM');
  } catch { /* already gone */ }
}

export async function runOrchestrator(plan) {
  console.log(`\n🚀 Starting orchestration for: ${plan.projectName}`);
  console.log(`   ${plan.milestones.length} milestones to complete\n`);

  for (const milestone of plan.milestones) {
    console.log(`\n--- Milestone ${milestone.id}: ${milestone.title} ---`);

    let approved = false;
    let attempt = 0;
    let finalPrNumber = null;

    while (!approved) {
      // Bug fix #2: append -v2, -v3 on retries so the branch name is unique
      const suffix = attempt > 0 ? `-v${attempt + 1}` : '';
      const branchName = `milestone-${milestone.id}-${slugify(milestone.title)}${suffix}`;

      // 1. Create branch
      await createBranch(branchName, REPO_PATH);

      // 2. Run subagent
      await runSubagent(milestone, plan, REPO_PATH);

      // 3. Screenshot if hasUI
      // Bug fix #1: screenshot localhost:3000 (the app), not SCREENSHOT_BASE_URL (the ngrok serving URL)
      let screenshotPath = null;
      if (milestone.hasUI) {
        let devServer = null;
        try {
          screenshotPath = path.join(REPO_PATH, 'screenshots', `milestone-${milestone.id}.png`);
          devServer = await startDevServer(REPO_PATH);
          const port = process.env.DEV_SERVER_PORT || 3000;
          await takeScreenshot(`http://localhost:${port}`, screenshotPath);
        } catch (err) {
          console.warn(`[orchestrator] Screenshot failed: ${err.message}`);
          screenshotPath = null;
        } finally {
          if (devServer) stopDevServer(devServer);
        }
      }

      // 4. Push branch + open PR
      await pushBranch(branchName, REPO_PATH);
      const { prNumber, url: prUrl } = await openPR(
        `Milestone ${milestone.id}: ${milestone.title}`,
        milestone.description,
        branchName,
        REPO_PATH
      );
      finalPrNumber = prNumber;

      console.log(`\nPR #${prNumber} open: ${prUrl} — review and merge when ready.`);

      // 5. Send SMS
      const smsMessage = `✅ Milestone ${milestone.id} done: ${milestone.title}. PR open at ${prUrl}. Reply 'approved' to continue.`;
      let smsSent = false;
      try {
        await sendUpdate(smsMessage, screenshotPath);
        smsSent = true;
      } catch (err) {
        console.error(`[orchestrator] SMS failed: ${err.message}`);
      }

      // 6. Wait for reply
      // Bug fix #3: if SMS is unavailable, halt and ask for terminal input — never auto-approve
      let reply;
      if (smsSent) {
        try {
          reply = await waitForReply();
          console.log(`[orchestrator] SMS reply received: ${reply}`);
        } catch (err) {
          console.error(`[orchestrator] Timed out waiting for SMS reply: ${err.message}`);
          reply = await askTerminal('SMS reply timed out. Enter response here (or "approved" to continue): ');
        }
      } else {
        console.log(`[orchestrator] SMS unavailable. PR is open at: ${prUrl}`);
        reply = await askTerminal('Enter response here (or "approved" to continue): ');
      }

      // 7. Check approval
      if (reply.toLowerCase().includes('approved')) {
        approved = true;
        console.log('[orchestrator] Approved. Continuing...');
      } else {
        console.log(`[orchestrator] Feedback: "${reply}". Re-running subagent with feedback...`);
        milestone.description = `${milestone.description}\n\nFeedback from reviewer: ${reply}`;
        await checkoutMain(REPO_PATH);
        attempt++;
      }
    }

    // 8. Poll until PR is merged
    if (finalPrNumber) {
      await pollUntilMerged(finalPrNumber, REPO_PATH);
    }

    // 9. Checkout main
    await checkoutMain(REPO_PATH);
    console.log(`\n✅ Milestone ${milestone.id} complete.\n`);
  }

  console.log('\n🎉 All milestones complete!');
}
