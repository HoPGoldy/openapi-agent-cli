import { join, resolve, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

let CONFIG_DIR = process.env.OAC_CONFIG_DIR || join(homedir(), ".config", "openapi-agent-cli");

export function setConfigDir(dir: string): void {
  CONFIG_DIR = dir;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

function getConfigFile(): string {
  return join(CONFIG_DIR, "config.json");
}

export interface ServiceConfig {
  url: string;
  openapi: string;
  headers?: Record<string, string>;
  ignore?: string[];
}

export interface AppConfig {
  services: Record<string, ServiceConfig>;
}

function isRemotePath(p: string): boolean {
  return p.startsWith("http://") || p.startsWith("https://");
}

function resolveOpenapiPath(openapi: string): string {
  if (isRemotePath(openapi)) return openapi;
  if (isAbsolute(openapi)) return openapi;
  return resolve(process.cwd(), openapi);
}

export function loadConfig(): AppConfig {
  const configFile = getConfigFile();
  if (!existsSync(configFile)) {
    return { services: {} };
  }
  return JSON.parse(readFileSync(configFile, "utf-8"));
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2));
}

export function getService(name: string): ServiceConfig | undefined {
  const config = loadConfig();
  return config.services[name];
}

export function addService(name: string, svc: ServiceConfig): void {
  const config = loadConfig();
  if (config.services[name]) {
    throw new Error(
      `Service "${name}" already exists. Use: oac config set ${name} --url/--openapi/--headers`,
    );
  }
  config.services[name] = {
    ...svc,
    openapi: resolveOpenapiPath(svc.openapi),
  };
  saveConfig(config);
}

export function updateService(name: string, partial: Partial<ServiceConfig>): void {
  const config = loadConfig();
  if (!config.services[name]) {
    throw new Error(
      `Service "${name}" not found. Use: oac config add ${name} --url <url> --openapi <url-or-file>`,
    );
  }
  const updated = { ...config.services[name], ...partial };
  if (partial.openapi) {
    updated.openapi = resolveOpenapiPath(partial.openapi);
  }
  config.services[name] = updated;
  saveConfig(config);
}

export function removeService(name: string): void {
  const config = loadConfig();
  if (!config.services[name]) {
    throw new Error(`Service "${name}" not found.`);
  }
  delete config.services[name];
  saveConfig(config);
}
