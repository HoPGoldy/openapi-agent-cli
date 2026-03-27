import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import SwaggerParser from "@apidevtools/swagger-parser";
import { getConfigDir, type ServiceConfig } from "./config.js";

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

let _cacheDirOverride: string | null = null;

export function setCacheDir(dir: string): void {
  _cacheDirOverride = dir;
}

function getCacheDir(): string {
  return _cacheDirOverride ?? join(getConfigDir(), "cache");
}

function isCacheValid(cachePath: string): boolean {
  if (!existsSync(cachePath)) return false;
  const data = JSON.parse(readFileSync(cachePath, "utf-8"));
  return Date.now() - data.fetchedAt < CACHE_TTL;
}

function readCache(cachePath: string): any {
  const data = JSON.parse(readFileSync(cachePath, "utf-8"));
  return data.spec;
}

function writeCache(cachePath: string, spec: any): void {
  const cacheDir = getCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), spec }, null, 2));
}

export async function fetchSpec(
  serviceName: string,
  serviceConfig: ServiceConfig,
  forceRefresh?: boolean,
): Promise<any> {
  const { openapi } = serviceConfig;
  const isRemote = openapi.startsWith("http://") || openapi.startsWith("https://");

  // Local file → read directly
  if (!isRemote) {
    const spec = await SwaggerParser.dereference(resolve(openapi));
    return spec;
  }

  // Remote URL → with cache
  const cachePath = join(getCacheDir(), `${serviceName}.spec.json`);

  if (!forceRefresh && isCacheValid(cachePath)) {
    return readCache(cachePath);
  }

  const res = await fetch(openapi, {
    headers: serviceConfig.headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch spec from ${openapi}: ${res.status}`);
  }

  const rawSpec = await res.json();
  const spec = await SwaggerParser.dereference(rawSpec);
  writeCache(cachePath, spec);

  return spec;
}
