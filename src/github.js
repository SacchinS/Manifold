import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

export async function createBranch(name, repoPath = process.cwd()) {
  execSync('git checkout main', { cwd: repoPath, stdio: 'inherit' });
  execSync('git pull origin main', { cwd: repoPath, stdio: 'inherit' });
  execSync(`git checkout -b ${name}`, { cwd: repoPath, stdio: 'inherit' });
}

export async function pushBranch(name, repoPath = process.cwd()) {
  execSync(`git push -u origin ${name}`, { cwd: repoPath, stdio: 'inherit' });
}

export async function openPR(title, body, branch, repoPath = process.cwd()) {
  const tmpFile = path.join(os.tmpdir(), `manifold-pr-body-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, body, 'utf-8');
  try {
    const escapedTitle = title.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `gh pr create --title "${escapedTitle}" --body-file "${tmpFile}" --base main --head ${branch}`,
      { cwd: repoPath }
    );
    const url = stdout.trim();
    const match = url.match(/\/pull\/(\d+)/);
    const prNumber = match ? parseInt(match[1], 10) : null;
    return { prNumber, url };
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

export async function pollUntilMerged(prNumber, repoPath = process.cwd(), intervalMs = 10000) {
  const TIMEOUT_MS = 30 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const check = async () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for PR #${prNumber} to merge after 30 minutes`));
        return;
      }
      try {
        const { stdout } = await execAsync(
          `gh pr view ${prNumber} --json state --jq '.state'`,
          { cwd: repoPath }
        );
        const state = stdout.trim();
        console.log(`  [github] PR #${prNumber} state: ${state}`);
        if (state === 'MERGED') {
          resolve();
        } else if (state === 'CLOSED') {
          reject(new Error(`PR #${prNumber} was closed without merging`));
        } else {
          setTimeout(check, intervalMs);
        }
      } catch (err) {
        console.error(`  [github] Error polling PR: ${err.message}`);
        setTimeout(check, intervalMs);
      }
    };
    check();
  });
}

export async function checkoutMain(repoPath = process.cwd()) {
  execSync('git checkout main', { cwd: repoPath, stdio: 'inherit' });
  execSync('git pull origin main', { cwd: repoPath, stdio: 'inherit' });
}
