#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';

import { loadApplicationEnv } from '@esl-pipeline/shared-infrastructure';

import { validateMarkdown } from '../src/validator.js';

loadApplicationEnv({
  moduleUrl: import.meta.url,
  memoizeKey: 'md-validator-cli',
});

const program = new Command()
  .name('md-validate')
  .description('Validate ESL assignment Markdown produced by the system prompt')
  .argument('<file>', 'Path to the .md file (the one with the fenced code block)')
  .option('--strict', 'Treat warnings as errors', false)
  .action(async (file: string, opts: { strict?: boolean }) => {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) {
      console.error(pc.red(`File not found: ${p}`));
      process.exit(1);
    }
    const result = await validateMarkdown({ path: p, strict: !!opts.strict });

    if (result.ok && (!opts.strict || result.warnings.length === 0)) {
      console.log(pc.green('✔ Validation passed'));
      if (result.warnings.length > 0) {
        console.log(pc.yellow(`Warnings (${result.warnings.length}):`));
        for (const w of result.warnings) console.log(pc.yellow(`  • ${w}`));
      }
      if (result.meta) {
        const topicValue = Array.isArray(result.meta.topic)
          ? result.meta.topic.join(', ')
          : result.meta.topic;
        console.log(pc.gray(`title: ${result.meta.title}`));
        console.log(pc.gray(`student: ${result.meta.student}`));
        console.log(pc.gray(`topic: ${topicValue}`));
        console.log(pc.gray(`input_type: ${result.meta.input_type}`));
        if (result.meta.study_text_type) {
          console.log(pc.gray(`study_text_type: ${result.meta.study_text_type}`));
        }
      }
      return;
    }

    if (result.errors.length > 0) {
      console.log(pc.red(`✖ Errors (${result.errors.length}):`));
      for (const e of result.errors) console.log(pc.red(`  • ${e}`));
    }
    if (result.warnings.length > 0) {
      console.log(pc.yellow(`Warnings (${result.warnings.length}):`));
      for (const w of result.warnings) console.log(pc.yellow(`  • ${w}`));
    }
    process.exit(1);
  });

program.parseAsync().catch((error) => {
  console.error(pc.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
