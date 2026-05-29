import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'child_process';
import { exec } from 'child_process';
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

export async function runOrchestrator(plan) {
  console.log(`\n🚀 Starting orchestration for: ${plan.projectName}`);
  console.log(`   ${plan.milestones.length} milestones to complete\n`);

  for (const milestone of plan.milestones) {
    console.log(`\n--- Milestone ${milestone.id}: ${milestone.title} ---`);

    let approved = false;

    while (!approved) {
      const branchName = `milestone-${milestone.id}-${slugify(milestone.title)}`;

      // 1. Create branch
      await createBranch(branchName, REPO_PATH);

      // 2. Run subagent
      await runSubagent(milestone, plan, REPO_PATH);

      // 3. Screenshot if hasUI
      let screenshotPath = null;
      if (milestone.hasUI && process.env.SCREENSHOT_BASE_URL) {
        try {
          screenshotPath = path.join(REPO_PATH, 'screenshots', `milestone-${milestone.id}.png`);
          await takeScreenshot(process.env.SCREENSHOT_BASE_URL, screenshotPath);
        } catch (err) {
          console.warn(`[orchestrator] Screenshot failed: ${err.message}`);
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

      console.log(`\nPR #${prNumber} open: ${prUrl} — review and merge when ready.`);

      // 5. Send SMS
      const smsMessage = `✅ Milestone ${milestone.id} done: ${milestone.title}. PR open at ${prUrl}. Reply 'approved' to continue.`;
      try {
        await sendUpdate(smsMessage, screenshotPath);
      } catch (err) {
        console.warn(`[orchestrator] SMS failed: ${err.message}`);
      }

      // 6. Wait for reply
      let reply = 'approved'; // default if SMS/Twilio not configured
      try {
        reply = await waitForReply();
        console.log(`[orchestrator] Reply received: ${reply}`);
      } catch (err) {
        console.warn(`[orchestrator] No SMS reply received (${err.message}). Treating as approved.`);
      }

      // 7. Check approval
      if (reply.toLowerCase().includes('approved')) {
        approved = true;
        console.log('[orchestrator] Approved. Continuing...');
      } else {
        console.log(`[orchestrator] Feedback: "${reply}". Re-running subagent with feedback...`);
        milestone.description = `${milestone.description}\n\nFeedback from reviewer: ${reply}`;
        // Will loop back and re-run the subagent on a new branch attempt
        await checkoutMain(REPO_PATH);
      }
    }

    // 8. Poll until PR is merged
    const branchName = `milestone-${milestone.id}-${slugify(milestone.title)}`;
    const { stdout } = await execAsync(
      `gh pr list --head ${branchName} --json number --jq '.[0].number'`,
      { cwd: REPO_PATH }
    );
    const prNumber = parseInt(stdout.trim(), 10);
    if (prNumber) {
      await pollUntilMerged(prNumber, REPO_PATH);
    }

    // 9. Checkout main
    await checkoutMain(REPO_PATH);
    console.log(`\n✅ Milestone ${milestone.id} complete.\n`);
  }

  console.log('\n🎉 All milestones complete!');
}
