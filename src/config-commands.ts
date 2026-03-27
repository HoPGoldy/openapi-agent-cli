import { Command } from "commander";
import {
  loadConfig,
  getService,
  addService,
  updateService,
  removeService,
  type ServiceConfig,
} from "./config.js";
import { fetchSpec } from "./spec-loader.js";
import { parseAndSave } from "./spec-parser.js";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage service configurations");

  // config add
  config
    .command("add <name>")
    .description("Add a new service")
    .requiredOption("--url <url>", "API base URL")
    .requiredOption("--openapi <spec>", "OpenAPI spec URL or local file path")
    .option("--headers <json>", "Default headers as JSON")
    .option("--ignore <json>", "Ignore patterns as JSON array (glob, matched against API paths)")
    .action(async (name: string, opts) => {
      if (getService(name)) {
        console.error(
          `✗ Service "${name}" already exists. Use: oac config set ${name} --url/--openapi/--headers`,
        );
        process.exit(1);
      }

      const headers = opts.headers ? JSON.parse(opts.headers) : undefined;
      const ignore = opts.ignore ? JSON.parse(opts.ignore) : undefined;
      const serviceConfig: ServiceConfig = {
        url: opts.url,
        openapi: opts.openapi,
        headers,
        ignore,
      };

      const spec = await fetchSpec(name, serviceConfig);
      const schema = parseAndSave(name, spec);
      console.log(`✓ Parsed ${schema.commands.length} commands from spec`);

      addService(name, serviceConfig);
      console.log(`✓ Service "${name}" added`);
    });

  // config set
  config
    .command("set <name>")
    .description("Update service configuration (partial merge)")
    .option("--url <url>", "API base URL")
    .option("--openapi <spec>", "OpenAPI spec URL or local file path")
    .option("--headers <json>", "Default headers as JSON")
    .option("--ignore <json>", "Ignore patterns as JSON array (glob, matched against API paths)")
    .action(async (name: string, opts) => {
      const existing = getService(name);
      if (!existing) {
        console.error(
          `✗ Service "${name}" not found. Use: oac config add ${name} --url <url> --openapi <url-or-file>`,
        );
        process.exit(1);
      }

      const partial: Partial<ServiceConfig> = {};
      if (opts.url) partial.url = opts.url;
      if (opts.openapi) partial.openapi = opts.openapi;
      if (opts.headers) partial.headers = JSON.parse(opts.headers);
      if (opts.ignore) partial.ignore = JSON.parse(opts.ignore);

      updateService(name, partial);
      const updated = getService(name)!;

      if (opts.openapi) {
        const spec = await fetchSpec(name, updated, true);
        const schema = parseAndSave(name, spec);
        console.log(`✓ Re-parsed ${schema.commands.length} commands from new spec`);
      }

      console.log(`✓ Service "${name}" updated`);
    });

  // config remove
  config
    .command("remove <name>")
    .description("Remove a service")
    .action((name: string) => {
      removeService(name);
      console.log(`✓ Service "${name}" removed`);
    });

  // config list
  config
    .command("list")
    .description("List all configured services")
    .action(() => {
      const appConfig = loadConfig();
      const entries = Object.entries(appConfig.services);
      if (entries.length === 0) {
        console.log("No services configured.");
        return;
      }
      for (const [name, svc] of entries) {
        const isRemote = svc.openapi.startsWith("http://") || svc.openapi.startsWith("https://");
        const sourceType = isRemote ? "remote" : "local";
        console.log(`${name}  ${svc.url}  openapi: ${svc.openapi} (${sourceType})`);
      }
    });

  // config refresh
  config
    .command("refresh [name]")
    .description("Refresh spec cache (re-fetch and re-parse)")
    .action(async (name?: string) => {
      const appConfig = loadConfig();

      if (name) {
        const svc = appConfig.services[name];
        if (!svc) {
          console.error(`✗ Service "${name}" not found.`);
          process.exit(1);
        }
        const spec = await fetchSpec(name, svc, true);
        const schema = parseAndSave(name, spec);
        console.log(`✓ Refreshed "${name}": ${schema.commands.length} commands`);
      } else {
        for (const [svcName, svc] of Object.entries(appConfig.services)) {
          const spec = await fetchSpec(svcName, svc, true);
          const schema = parseAndSave(svcName, spec);
          console.log(`✓ Refreshed "${svcName}": ${schema.commands.length} commands`);
        }
      }
    });
}
