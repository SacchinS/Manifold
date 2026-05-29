import { exec, execSync } from 'child_process';
import { promisify } from 'util';

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
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedBody = body.replace(/"/g, '\\"');
  const { stdout } = await execAsync(
    `gh pr create --title "${escapedTitle}" --body "${escapedBody}" --base main --head ${branch}`,
    { cwd: repoPath }
  );
  const url = stdout.trim();
  const match = url.match(/\/pull\/(\d+)/);
  const prNumber = match ? parseInt(match[1], 10) : null;
  return { prNumber, url };
}

export async function pollUntilMerged(prNumber, repoPath = process.cwd(), intervalMs = 10000) {
  return new Promise((resolve) => {
    const check = async () => {
      try {
        const { stdout } = await execAsync(
          `gh pr view ${prNumber} --json state --jq '.state'`,
          { cwd: repoPath }
        );
        const state = stdout.trim();
        console.log(`  [github] PR #${prNumber} state: ${state}`);
        if (state === 'MERGED') {
          resolve();
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
