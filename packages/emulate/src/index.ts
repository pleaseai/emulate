#!/usr/bin/env node
import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name("emulate")
  .description("Local drop-in replacement services for CI and no-network sandboxes")
  .version(pkg.version);

program
  .command("start", { isDefault: true })
  .description("Start service emulators (default command)")
  .option("-p, --port <port>", "base port (services use port, port+1, ...)", (v) => parseInt(v, 10), 4000)
  .option("-s, --service <services>", `comma-separated services to start`)
  .option("--seed <file>", "seed config file (yaml or json)")
  .option("--base-url <url>", "override base URL (single service only)")
  .action(startCommand);

program
  .command("init")
  .description("Create an emulate.config.yaml with example seed data")
  .option("-s, --service <services>", "comma-separated services to include")
  .option("-f, --force", "overwrite existing config file")
  .action(initCommand);

program.command("list").description("List available service emulators").action(listCommand);

program.parse();
