#!/usr/bin/env node
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { initCommand } from './commands/init.js'
import { listCommand } from './commands/list.js'
import { startCommand } from './commands/start.js'

const program = new Command()

program
  .name('emulate')
  .description('Local drop-in replacement services for CI and no-network sandboxes')
  .version(pkg.version)

program
  .command('start', { isDefault: true })
  .description('Start service emulators (default command)')
  .option('-p, --port <port>', 'base port, default 4000 (services use port, port+1, ...; falls back to EMULATE_PORT or PORT)', v => Number.parseInt(v, 10))
  .option('-s, --service <services>', `comma-separated services to start`)
  .option('--seed <file>', 'seed config file (yaml or json)')
  .option('--base-url <url>', 'override base URL (supports {service} interpolation)')
  .option('--portless', 'serve over HTTPS via portless (auto-registers <service>.emulate aliases)')
  .action(startCommand)

program
  .command('init')
  .description('Create an emulate.config.yaml with example seed data')
  .option('-s, --service <services>', 'comma-separated services to include')
  .option('-f, --force', 'overwrite existing config file')
  .action(initCommand)

program.command('list').description('List available service emulators').action(listCommand)

program.parse()
