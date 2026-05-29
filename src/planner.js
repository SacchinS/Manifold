import Anthropic from '@anthropic-ai/sdk';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a software planning agent. Help the user define what they want to build. Ask clarifying questions about features, stack preferences, and constraints. Once you have enough information, propose a structured build plan: a list of milestones, each with a title, description, assigned specialist (backend-engineer, frontend-engineer, database-engineer, or test-runner), and whether it will produce a visible UI (for screenshot decisions). Ask the user to confirm the plan before returning it.

When the user confirms the plan, output ONLY a valid JSON object in this exact format (no markdown, no explanation, just the JSON):
{
  "projectName": "...",
  "stack": "...",
  "milestones": [
    {
      "id": 1,
      "title": "...",
      "description": "...",
      "agent": "backend-engineer",
      "hasUI": false
    }
  ]
}`;

const CONFIRM_KEYWORDS = ['yes', 'confirmed', 'approved', 'looks good', 'approve', 'confirm', 'proceed', 'go ahead', 'ship it'];

function isConfirmation(text) {
  const lower = text.toLowerCase().trim();
  return CONFIRM_KEYWORDS.some(kw => lower.includes(kw));
}

function tryExtractPlan(text) {
  const jsonMatch = text.match(/\{[\s\S]*"projectName"[\s\S]*"milestones"[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

export async function runPlanner() {
  console.log(chalk.bold('\n🚀 Manifold Planning Agent\n'));
  console.log(chalk.gray('Tell me what you want to build. Type your responses below.\n'));

  const messages = [];

  while (true) {
    const { userInput } = await inquirer.prompt([{
      type: 'input',
      name: 'userInput',
      message: chalk.blue('You:'),
      validate: input => input.trim() ? true : 'Please enter a message',
    }]);

    messages.push({ role: 'user', content: userInput.trim() });

    const spinner = ora('Thinking...').start();

    let response;
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      });
    } finally {
      spinner.stop();
    }

    const assistantText = response.content[0].text;
    messages.push({ role: 'assistant', content: assistantText });

    console.log(chalk.green('\nClaude: ') + assistantText + '\n');

    if (isConfirmation(userInput)) {
      let plan = tryExtractPlan(assistantText);

      if (!plan) {
        // Ask Claude to produce the JSON
        const jsonSpinner = ora('Extracting plan...').start();
        messages.push({
          role: 'user',
          content: 'Please output the final plan as a JSON object only — no markdown, no explanation. Just the raw JSON with projectName, stack, and milestones array.',
        });
        const jsonResponse = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages,
        });
        jsonSpinner.stop();
        const jsonText = jsonResponse.content[0].text;
        messages.push({ role: 'assistant', content: jsonText });
        plan = tryExtractPlan(jsonText);
      }

      if (plan) {
        console.log(chalk.bold('\n✅ Plan confirmed!\n'));
        console.log(chalk.gray(JSON.stringify(plan, null, 2)));
        return plan;
      } else {
        console.log(chalk.yellow('\nCould not extract structured plan. Please continue the conversation.\n'));
      }
    }
  }
}
