import { Command } from "commander";
import picomatch from "picomatch";
import type { ServiceSchema, PropertySchema, CommandSchema as CmdSchema } from "./spec-parser.js";
import type { ServiceConfig } from "./config.js";
import { apiRequest, apiUpload, apiFormRequest, apiRawRequest } from "./request.js";

export function safeJsonParse(value: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (e) {
    console.error(`✗ Invalid JSON in ${flag}: ${(e as Error).message}`);
    process.exit(1);
  }
}

function formatPropertyLine(name: string, prop: PropertySchema, required: boolean, indent: number): string {
  const pad = "  ".repeat(indent);
  const reqTag = required ? " (required)" : "";
  let typeName = prop.type;
  if (prop.type === "array" && prop.items) {
    typeName = `${prop.items.type}[]`;
  }
  const enumStr = prop.enum ? `  enum: [${prop.enum.join(", ")}]` : "";
  const defaultStr = prop.default !== undefined ? `  default: ${JSON.stringify(prop.default)}` : "";
  const desc = prop.description ? `  ${prop.description}` : "";
  return `${pad}${name.padEnd(20 - indent * 2)}${typeName.padEnd(12)}${reqTag}${desc}${enumStr}${defaultStr}`;
}

function formatProperties(
  properties: Record<string, PropertySchema>,
  requiredFields: string[],
  indent: number,
): string[] {
  const lines: string[] = [];
  for (const [name, prop] of Object.entries(properties)) {
    const isRequired = requiredFields.includes(name);
    lines.push(formatPropertyLine(name, prop, isRequired, indent));
    if (prop.type === "object" && prop.properties) {
      lines.push(...formatProperties(prop.properties, prop.required ?? [], indent + 1));
    }
    if (prop.type === "array" && prop.items?.type === "object" && prop.items.properties) {
      lines.push(`${"  ".repeat(indent + 1)}items:`);
      lines.push(...formatProperties(prop.items.properties, prop.items.required ?? [], indent + 2));
    }
  }
  return lines;
}

function buildHelpText(cmd: CmdSchema): string {
  const sections: string[] = [];

  sections.push(`\nAPI: ${cmd.method} ${cmd.path}`);

  if (cmd.contentType !== "application/json") {
    sections.push(`Content-Type: ${cmd.contentType}`);
  }

  if (cmd.deprecated) {
    sections.push("\n⚠ This API is deprecated");
  }

  // Path parameters
  const pathParams = cmd.parameters.filter((p) => p.in === "path");
  if (pathParams.length > 0) {
    sections.push("\nPath Parameters (--params):");
    for (const p of pathParams) {
      const req = p.required ? " (required)" : "";
      const desc = p.description ? `  ${p.description}` : "";
      const enumStr = p.enum ? `  enum: [${p.enum.join(", ")}]` : "";
      const defaultStr = p.default !== undefined ? `  default: ${JSON.stringify(p.default)}` : "";
      sections.push(`  ${p.name.padEnd(20)}${p.type.padEnd(12)}${req}${desc}${enumStr}${defaultStr}`);
    }
  }

  // Query parameters
  const queryParams = cmd.parameters.filter((p) => p.in === "query");
  if (queryParams.length > 0) {
    sections.push("\nQuery Parameters (--query):");
    for (const p of queryParams) {
      const req = p.required ? " (required)" : "";
      const desc = p.description ? `  ${p.description}` : "";
      const enumStr = p.enum ? `  enum: [${p.enum.join(", ")}]` : "";
      const defaultStr = p.default !== undefined ? `  default: ${JSON.stringify(p.default)}` : "";
      sections.push(`  ${p.name.padEnd(20)}${p.type.padEnd(12)}${req}${desc}${enumStr}${defaultStr}`);
    }
  }

  // Header parameters
  const headerParams = cmd.parameters.filter((p) => p.in === "header");
  if (headerParams.length > 0) {
    sections.push("\nHeader Parameters (--header):");
    for (const p of headerParams) {
      const req = p.required ? " (required)" : "";
      const desc = p.description ? `  ${p.description}` : "";
      sections.push(`  ${p.name.padEnd(20)}${p.type.padEnd(12)}${req}${desc}`);
    }
  }

  // Body schema
  if (cmd.bodySchema) {
    sections.push("\nBody Schema (--body):");
    sections.push(...formatProperties(cmd.bodySchema.properties, cmd.bodySchema.required, 1));
  }

  return sections.join("\n");
}

export function buildCommands(group: Command, schema: ServiceSchema, serviceConfig: ServiceConfig): void {
  const ignorePatterns = serviceConfig.ignore ?? [];
  const isIgnored = ignorePatterns.length > 0 ? picomatch(ignorePatterns) : null;

  for (const cmd of schema.commands) {
    if (isIgnored && isIgnored(cmd.path)) continue;

    const desc = cmd.deprecated ? `[DEPRECATED] ${cmd.description}` : cmd.description;
    const sub = group.command(cmd.name).description(desc);

    sub.option("--body <json>", "JSON request body");
    sub.option("--raw-body <text>", "Raw request body (for xml/text content types)");
    sub.option("--query <json>", "URL query parameters as JSON");
    sub.option("--params <json>", "Path parameters as JSON");
    sub.option("--header <json>", "Custom request headers as JSON");
    sub.option("--output <file>", "Save response to file (for binary downloads)");
    sub.option("--timeout <ms>", "Request timeout in milliseconds", "30000");

    const hasExtraHelp =
      cmd.parameters?.length > 0 ||
      cmd.bodySchema ||
      cmd.deprecated ||
      cmd.contentType !== "application/json";
    if (hasExtraHelp) {
      sub.addHelpText("after", buildHelpText(cmd));
    }

    sub.action(async (opts) => {
      const query = safeJsonParse(opts.query, "--query");
      const body = safeJsonParse(opts.body, "--body");
      const params = safeJsonParse(opts.params, "--params");
      const headers = safeJsonParse(opts.header, "--header") as Record<string, string> | undefined;
      const timeout = Number(opts.timeout);
      const output = opts.output;
      const rawBody: string | undefined = opts.rawBody;

      // Replace path params: /api/diary/{id} + {id: "abc"} → /api/diary/abc
      const resolvedPath = params
        ? cmd.path.replace(/\{(\w+)\}/g, (_, key) => {
            if (!(key in params)) throw new Error(`Missing path param: ${key}`);
            return encodeURIComponent(String(params[key]));
          })
        : cmd.path;

      const isMultipart = cmd.contentType === "multipart/form-data";
      const isFormUrlEncoded = cmd.contentType === "application/x-www-form-urlencoded";
      const isJson = cmd.contentType === "application/json";

      if (isMultipart && body) {
        const binaryFields = new Set(cmd.binaryFields);
        const result = await apiUpload(
          serviceConfig,
          resolvedPath,
          body,
          binaryFields,
          query,
          headers,
          timeout,
        );
        console.log(JSON.stringify(result, null, 2));
      } else if (isFormUrlEncoded) {
        const result = await apiFormRequest(
          serviceConfig,
          cmd.method,
          resolvedPath,
          body,
          query,
          headers,
          timeout,
        );
        console.log(JSON.stringify(result, null, 2));
      } else if (!isJson || rawBody) {
        const result = await apiRawRequest(
          serviceConfig,
          cmd.method,
          resolvedPath,
          cmd.contentType,
          rawBody,
          query,
          headers,
          timeout,
        );
        if (result !== null) {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        const result = await apiRequest(
          serviceConfig,
          cmd.method,
          resolvedPath,
          body,
          query,
          headers,
          timeout,
          output,
        );
        if (result !== null) {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    });
  }
}
