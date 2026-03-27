import { Command } from "commander";
import { loadConfig } from "./config.js";
import { loadSchema } from "./spec-parser.js";
import { buildCommands } from "./command-builder.js";
import { registerConfigCommands } from "./config-commands.js";

const program = new Command().name("oac").version("1.0.0").description("OpenAPI-driven CLI for services");

// 1. Register built-in config commands
registerConfigCommands(program);

// 2. Register subcommands for each configured service
const config = loadConfig();

for (const [name, serviceConfig] of Object.entries(config.services)) {
  const schema = loadSchema(name);

  if (!schema) {
    program
      .command(name)
      .description(`${name} service (schema missing)`)
      .action(() => {
        console.error(`✗ Schema not found. Run: oac config refresh ${name}`);
        process.exit(1);
      });
    continue;
  }

  const group = program.command(name).description(`${name} service`);
  buildCommands(group, schema, serviceConfig);
}

program.parse();
