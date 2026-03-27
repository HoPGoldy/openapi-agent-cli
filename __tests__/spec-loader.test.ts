import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchSpec, setCacheDir } from "../src/spec-loader.js";
import type { ServiceConfig } from "../src/config.js";

describe("spec-loader", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oac-loader-test-"));
    setCacheDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("loads local spec file successfully", async () => {
    const specPath = join(import.meta.dirname, "fixtures/test-spec.json");
    const config: ServiceConfig = {
      url: "http://localhost:3499",
      openapi: specPath,
    };

    const spec = await fetchSpec("test", config);
    expect(spec).toBeDefined();
    expect((spec as any).openapi).toBe("3.0.0");
    expect((spec as any).paths).toBeDefined();
  });

  it("fetches remote spec and caches it", async () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Remote", version: "1.0" },
      paths: { "/api/test": { get: { description: "test" } } },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockSpec), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const config: ServiceConfig = {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
      headers: { Authorization: "Bearer token" },
    };

    const spec = await fetchSpec("remote-svc", config);
    expect(spec).toBeDefined();
    expect((spec as any).openapi).toBe("3.0.0");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify headers were passed
    const fetchCall = fetchSpy.mock.calls[0];
    expect((fetchCall[1] as any).headers?.Authorization).toBe("Bearer token");
  });

  it("uses cache when valid", async () => {
    // Write a valid cache
    mkdirSync(tempDir, { recursive: true });
    const cacheData = {
      fetchedAt: Date.now(),
      spec: {
        openapi: "3.0.0",
        info: { title: "Cached", version: "1.0" },
        paths: { "/api/cached": { get: { description: "cached endpoint" } } },
      },
    };
    writeFileSync(join(tempDir, "cached-svc.spec.json"), JSON.stringify(cacheData));

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const config: ServiceConfig = {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    };

    const spec = await fetchSpec("cached-svc", config);
    expect((spec as any).openapi).toBe("3.0.0");
    expect((spec as any).info.title).toBe("Cached");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-fetches when cache expired", async () => {
    // Write expired cache
    mkdirSync(tempDir, { recursive: true });
    const cacheData = {
      fetchedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      spec: {
        openapi: "3.0.0",
        info: { title: "Old", version: "1.0" },
        paths: {},
      },
    };
    writeFileSync(join(tempDir, "expired-svc.spec.json"), JSON.stringify(cacheData));

    const freshSpec = {
      openapi: "3.0.0",
      info: { title: "Fresh", version: "2.0" },
      paths: { "/api/new": { get: { description: "new" } } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(freshSpec), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const config: ServiceConfig = {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    };

    const spec = await fetchSpec("expired-svc", config);
    expect((spec as any).info.title).toBe("Fresh");
  });

  it("ignores cache when forceRefresh is true", async () => {
    // Write valid cache
    mkdirSync(tempDir, { recursive: true });
    const cacheData = {
      fetchedAt: Date.now(),
      spec: {
        openapi: "3.0.0",
        info: { title: "Cached", version: "1.0" },
        paths: {},
      },
    };
    writeFileSync(join(tempDir, "force-svc.spec.json"), JSON.stringify(cacheData));

    const freshSpec = {
      openapi: "3.0.0",
      info: { title: "Forced Fresh", version: "2.0" },
      paths: { "/api/forced": { get: { description: "forced" } } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(freshSpec), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const config: ServiceConfig = {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    };

    const spec = await fetchSpec("force-svc", config, true);
    expect((spec as any).info.title).toBe("Forced Fresh");
  });

  it("throws on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    const config: ServiceConfig = {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    };

    await expect(fetchSpec("fail-svc", config)).rejects.toThrow(/Failed to fetch spec/);
  });
});
