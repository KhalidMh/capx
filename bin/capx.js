#!/usr/bin/env node

import { Command } from 'commander'
import { printNewCommandArgs } from '../src/commands/new.js'

const program = new Command()

program.name('capx').description('An opinionated installer for SAP CAP Node.js projects.')

program
  .command('new')
  .argument('<project-name>')
  .option('--force', 'overwrite an existing target directory')
  .action((name, options) => {
    printNewCommandArgs(name, options)
  })

await program.parseAsync(process.argv)
