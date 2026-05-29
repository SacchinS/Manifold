import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const client = new Anthropic();

const SYSTEM_PROMPTS = {
  'backend-engineer': 'Expert in Node.js, Express, REST APIs. Write clean, validated, production-quality code. Never expose stack traces.',
  'frontend-engineer': 'Expert in HTML, CSS, vanilla JS or React. Clean, responsive UI. Practical design.',
  'database-engineer': 'Expert in SQLite (better-sqlite3). Idempotent schemas, prices in cents, realistic seed data.',
  'test-runner': 'Run build/lint checks, fix straightforward errors, report pass/fail.',
};

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from disk.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_bash',
    description: 'Run a bash command and return its output.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command to execute' },
      },
      required: ['command'],
    },
  },
];

function executeTool(toolName, toolInput, repoPath) {
  try {
    if (toolName === 'read_file') {
      const filePath = path.resolve(repoPath, toolInput.path);
      return fs.readFileSync(filePath, 'utf-8');
    }

    if (toolName === 'write_file') {
      const filePath = path.resolve(repoPath, toolInput.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, toolInput.content, 'utf-8');
      return `Written: ${filePath}`;
    }

    if (toolName === 'run_bash') {
      const result = execSync(toolInput.command, {
        cwd: repoPath,
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result || '(no output)';
    }

    return `Unknown tool: ${toolName}`;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

export default async function runSubagent(milestone, plan, repoPath) {
  const systemPrompt =
    SYSTEM_PROMPTS[milestone.agent] ||
    'Expert software engineer. Write clean, production-quality code.';

  const userPrompt = `## Task: ${milestone.title}

${milestone.description}

## Full Project Plan
${JSON.stringify(plan, null, 2)}

## Working Directory
${repoPath}

Complete this milestone by reading existing files for context, then writing the required code. Use run_bash to verify your work where appropriate.`;

  const messages = [{ role: 'user', content: userPrompt }];

  console.log(`\n[subagent:${milestone.agent}] Starting milestone ${milestone.id}: ${milestone.title}`);

  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find((b) => b.type === 'text');
      if (text) console.log(`\n[subagent:${milestone.agent}] Done: ${text.text.slice(0, 200)}`);
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        console.log(`  [tool] ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
        const result = executeTool(block.name, block.input, repoPath);
        console.log(`  [result] ${String(result).slice(0, 150)}`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: String(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  // Stage and commit all changes
  try {
    execSync('git add -A', { cwd: repoPath });
    execSync(`git commit -m "feat: ${milestone.title}"`, { cwd: repoPath });
    console.log(`[subagent] Committed: feat: ${milestone.title}`);
  } catch (err) {
    console.log(`[subagent] Commit skipped (nothing to commit or error): ${err.message}`);
  }
}
