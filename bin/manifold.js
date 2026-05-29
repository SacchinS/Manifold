#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { runPlanner } from '../src/planner.js';
import { runOrchestrator } from '../src/orchestrator.js';

const program = new Command();

program
  .name('manifold')
  .description('Ship software through a team of AI agents')
  .version('0.1.0');

program
  .command('run')
  .description('Start a new build session')
  .action(async () => {
    const plan = await runPlanner();
    await runOrchestrator(plan);
  });

program.parse();
