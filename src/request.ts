import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ServiceConfig } from "./config.js";

function getFilenameFromResponse(res: Response): string | null {
  const disposition = res.headers.get("content-disposition");
  if (!disposition) return null;
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\s]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function handleResponse(res: Response, output?: string): Promise<unknown | null> {
  const contentType = res.headers.get("content-type") ?? "";

  const isJson = contentType.includes("application/json");
  const isText = contentType.startsWith("text/") || contentType.includes("xml");

  // Binary response → save to file
  if (!isJson && !isText) {
    const savePath = output ?? getFilenameFromResponse(res) ?? "download";
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(savePath, buffer);
    const sizeKB = (buffer.byteLength / 1024).toFixed(1);
    console.log(`✓ Saved to ${savePath} (${sizeKB} KB)`);
    return null;
  }

  // Read body as text first for safe JSON parsing
  const text = await res.text();

  // Text response (non-JSON)
  if (isText && !isJson) {
    console.log(text);
    return null;
  }

  // JSON response (with fallback for invalid JSON body)
  try {
    return JSON.parse(text);
  } catch {
    console.log(text);
    return null;
  }
}

export async function apiRequest(
  config: ServiceConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  timeout = 30000,
  output?: string,
): Promise<unknown | null> {
  const url = new URL(`${config.url}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
      ...customHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ [${res.status}] ${text}`);
    process.exit(1);
  }

  return handleResponse(res, output);
}

export async function apiFormRequest(
  config: ServiceConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  timeout = 30000,
): Promise<unknown> {
  const url = new URL(`${config.url}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const params = new URLSearchParams();
  if (body) {
    for (const [k, v] of Object.entries(body)) {
      params.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...config.headers,
      ...customHeaders,
    },
    body: params.toString(),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ [${res.status}] ${text}`);
    process.exit(1);
  }

  return handleResponse(res);
}

export async function apiRawRequest(
  config: ServiceConfig,
  method: string,
  path: string,
  contentType: string,
  rawBody?: string,
  query?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  timeout = 30000,
): Promise<unknown | null> {
  const url = new URL(`${config.url}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      "Content-Type": contentType,
      ...config.headers,
      ...customHeaders,
    },
    body: rawBody,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ [${res.status}] ${text}`);
    process.exit(1);
  }

  return handleResponse(res);
}

export async function apiUpload(
  config: ServiceConfig,
  path: string,
  body: Record<string, unknown>,
  binaryFields: Set<string>,
  query?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  timeout = 30000,
): Promise<unknown> {
  const url = new URL(`${config.url}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const formData = new FormData();

  for (const [k, v] of Object.entries(body)) {
    if (binaryFields.has(k)) {
      const filePath = String(v);
      const file = new Blob([await readFile(filePath)]);
      formData.append(k, file, basename(filePath));
    } else {
      formData.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { ...config.headers, ...customHeaders },
    body: formData,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ [${res.status}] ${text}`);
    process.exit(1);
  }

  return handleResponse(res);
}
