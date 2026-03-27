import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getConfigDir } from "./config.js";

export interface ParamSchema {
  name: string;
  in: "path" | "query" | "header";
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
}

export interface PropertySchema {
  type: string;
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

export interface BodySchema {
  required: string[];
  properties: Record<string, PropertySchema>;
}

export interface CommandSchema {
  name: string;
  description: string;
  method: string;
  path: string;
  contentType: string;
  binaryFields: string[];
  parameters: ParamSchema[];
  bodySchema?: BodySchema;
  deprecated?: boolean;
}

export interface ServiceSchema {
  generatedAt: number;
  commands: CommandSchema[];
}

let _schemaDirOverride: string | null = null;

export function setSchemaDir(dir: string): void {
  _schemaDirOverride = dir;
}

function getSchemaDir(): string {
  return _schemaDirOverride ?? join(getConfigDir(), "cache");
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function isOperation(method: string): boolean {
  return HTTP_METHODS.has(method);
}

export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function pathToCommandName(path: string): string {
  return path
    .replace(/^\//, "")
    .split("/")
    .map((seg) => seg.replace(/[{}]/g, ""))
    .map((seg) => camelToKebab(seg))
    .join("-");
}

function getContentType(operation: any): string {
  const content = operation.requestBody?.content;
  if (!content) return "application/json";
  if (content["multipart/form-data"]) return "multipart/form-data";
  if (content["application/json"]) return "application/json";
  if (content["application/x-www-form-urlencoded"]) return "application/x-www-form-urlencoded";
  // Return the first available content type
  const keys = Object.keys(content);
  return keys.length > 0 ? keys[0] : "application/json";
}

function extractBinaryFields(operation: any): string[] {
  const schema = operation.requestBody?.content?.["multipart/form-data"]?.schema;
  if (!schema?.properties) return [];
  return Object.entries(schema.properties)
    .filter(([, prop]: [string, any]) => prop.format === "binary")
    .map(([name]) => name);
}

function resolveComposedSchema(schema: any): any {
  if (!schema) return schema;

  if (schema.allOf) {
    const merged: any = { type: "object", properties: {}, required: [] };
    for (const sub of schema.allOf) {
      const resolved = resolveComposedSchema(sub);
      Object.assign(merged.properties, resolved.properties ?? {});
      merged.required.push(...(resolved.required ?? []));
    }
    // Preserve top-level own properties
    Object.assign(merged.properties, schema.properties ?? {});
    merged.required.push(...(schema.required ?? []));
    if (merged.required.length === 0) delete merged.required;
    return merged;
  }

  if (schema.oneOf || schema.anyOf) {
    const variants = schema.oneOf ?? schema.anyOf;
    const merged: any = { type: "object", properties: {}, required: [] };
    for (const sub of variants) {
      const resolved = resolveComposedSchema(sub);
      Object.assign(merged.properties, resolved.properties ?? {});
    }
    if (merged.required.length === 0) delete merged.required;
    return merged;
  }

  return schema;
}

function extractPropertySchema(prop: any): PropertySchema {
  const resolved = resolveComposedSchema(prop);
  const result: PropertySchema = { type: resolved.type ?? "any" };
  if (resolved.description) result.description = resolved.description;
  if (resolved.enum) result.enum = resolved.enum;
  if (resolved.default !== undefined) result.default = resolved.default;
  if (resolved.type === "array" && resolved.items) {
    result.items = extractPropertySchema(resolved.items);
  }
  if (resolved.type === "object" && resolved.properties) {
    result.properties = {};
    for (const [name, sub] of Object.entries(resolved.properties as Record<string, any>)) {
      result.properties[name] = extractPropertySchema(sub);
    }
    if (resolved.required?.length) result.required = resolved.required;
  }
  return result;
}

function extractParameters(operation: any, pathLevelParams: any[] = []): ParamSchema[] {
  // Merge: operation params override path-level params with same name+in
  const mergedRaw = [...pathLevelParams];
  for (const opParam of operation.parameters ?? []) {
    const idx = mergedRaw.findIndex((p: any) => p.name === opParam.name && p.in === opParam.in);
    if (idx >= 0) {
      mergedRaw[idx] = opParam;
    } else {
      mergedRaw.push(opParam);
    }
  }

  const params: ParamSchema[] = [];
  for (const p of mergedRaw) {
    if (p.in === "path" || p.in === "query" || p.in === "header") {
      const param: ParamSchema = {
        name: p.name,
        in: p.in,
        type: p.schema?.type ?? "string",
        required: p.required ?? p.in === "path",
      };
      if (p.description) param.description = p.description;
      if (p.schema?.enum) param.enum = p.schema.enum;
      if (p.schema?.default !== undefined) param.default = p.schema.default;
      params.push(param);
    }
  }
  return params;
}

function extractBodySchema(operation: any): BodySchema | undefined {
  const content = operation.requestBody?.content;
  if (!content) return undefined;
  // Try content types in priority order
  const mediaType =
    content["application/json"] ??
    content["multipart/form-data"] ??
    content["application/x-www-form-urlencoded"] ??
    Object.values(content)[0];
  const rawSchema = (mediaType as any)?.schema;
  if (!rawSchema) return undefined;

  const schema = resolveComposedSchema(rawSchema);
  if (!schema?.properties) return undefined;

  const properties: Record<string, PropertySchema> = {};
  for (const [name, prop] of Object.entries(schema.properties as Record<string, any>)) {
    properties[name] = extractPropertySchema(prop);
  }
  return {
    required: schema.required ?? [],
    properties,
  };
}

export function parseSpec(spec: any): ServiceSchema {
  const commands: CommandSchema[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const pathLevelParams = (pathItem as any).parameters ?? [];

    for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
      if (!isOperation(method)) continue;

      const contentType = getContentType(operation);
      const binaryFields = contentType === "multipart/form-data" ? extractBinaryFields(operation) : [];

      const cmd: CommandSchema = {
        name: `${method}-${pathToCommandName(path)}`,
        description: operation.description ?? operation.summary ?? "",
        method: method.toUpperCase(),
        path,
        contentType,
        binaryFields,
        parameters: extractParameters(operation, pathLevelParams),
        bodySchema: extractBodySchema(operation),
      };
      if (operation.deprecated) cmd.deprecated = true;

      commands.push(cmd);
    }
  }

  // Command name collision detection
  const nameSet = new Set<string>();
  for (const cmd of commands) {
    if (nameSet.has(cmd.name)) {
      throw new Error(`Command name collision: "${cmd.name}" (path: ${cmd.path})`);
    }
    nameSet.add(cmd.name);
  }

  return { generatedAt: Date.now(), commands };
}

export function parseAndSave(serviceName: string, spec: any): ServiceSchema {
  const schema = parseSpec(spec);
  const schemaDir = getSchemaDir();
  mkdirSync(schemaDir, { recursive: true });
  const schemaPath = join(schemaDir, `${serviceName}.schema.json`);
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  return schema;
}

export function loadSchema(serviceName: string): ServiceSchema | null {
  const schemaPath = join(getSchemaDir(), `${serviceName}.schema.json`);
  if (!existsSync(schemaPath)) return null;
  return JSON.parse(readFileSync(schemaPath, "utf-8"));
}
