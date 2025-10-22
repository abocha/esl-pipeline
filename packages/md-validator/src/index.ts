#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import chalk from 'chalk'
import { validateMarkdownFile } from './validator.js' // <-- add .js

const program = new Command()
  .name('md-validate')
  .description('Validate ESL assignment Markdown produced by the system prompt')
  .argument('<file>', 'Path to the .md file (the one with the fenced code block)')
  .option('--strict', 'Treat warnings as errors', false)
  .action((file: string, opts: { strict?: boolean }) => {
    const p = path.resolve(process.cwd(), file)
    if (!fs.existsSync(p)) {
      console.error(chalk.red(`File not found: ${p}`))
      process.exit(1)
    }
    const raw = fs.readFileSync(p, 'utf8')
    const result = validateMarkdownFile(raw, { strict: !!opts.strict })

    if (result.ok && (!opts.strict || result.warnings.length === 0)) {
      console.log(chalk.green('✔ Validation passed'))
      if (result.warnings.length) {
        console.log(chalk.yellow(`Warnings (${result.warnings.length}):`))
        for (const w of result.warnings) console.log(chalk.yellow(`  • ${w}`))
      }
      if (result.meta) {
        console.log(chalk.gray(`title: ${result.meta.title}`))
        console.log(chalk.gray(`student: ${result.meta.student}`))
        console.log(chalk.gray(`topic: ${result.meta.topic}`))
        console.log(chalk.gray(`input_type: ${result.meta.input_type}`))
      }
      process.exit(0)
    }

    if (result.errors.length) {
      console.log(chalk.red(`✖ Errors (${result.errors.length}):`))
      for (const e of result.errors) console.log(chalk.red(`  • ${e}`))
    }
    if (result.warnings.length) {
      console.log(chalk.yellow(`Warnings (${result.warnings.length}):`))
      for (const w of result.warnings) console.log(chalk.yellow(`  • ${w}`))
    }
    process.exit(1)
  })

program.parse()
