import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import pc from "picocolors";
import { SERVICE_NAMES, SERVICE_REGISTRY, type ServiceName } from "../registry.js";

export interface InitOptions {
  service?: string;
  force?: boolean;
}

const CONFIG_FILE = "emulate.config.yaml";

export function initCommand(options: InitOptions): void {
  const fullPath = resolve(CONFIG_FILE);

  if (existsSync(fullPath) && !options.force) {
    console.error(`${CONFIG_FILE} already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  let services: ServiceName[];
  if (options.service) {
    services = options.service.split(",").map((s) => s.trim()) as ServiceName[];
    for (const svc of services) {
      if (!SERVICE_NAMES.includes(svc)) {
        console.error(`Unknown service: ${svc}`);
        console.error(`Available services: ${SERVICE_NAMES.join(", ")}`);
        process.exit(1);
      }
    }
  } else {
    services = [...SERVICE_NAMES];
  }

  const config: Record<string, unknown> = {
    tokens: {
      test_token_admin: { login: "admin" },
    },
  };

  for (const svc of services) {
    Object.assign(config, SERVICE_REGISTRY[svc].initConfig);
  }

  writeFileSync(fullPath, stringifyYaml(config), "utf-8");
  console.log(`${pc.green("✓")} Created ${CONFIG_FILE} with seed data for: ${services.join(", ")}`);
}
