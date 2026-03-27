import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  saveConfig,
  getService,
  addService,
  updateService,
  removeService,
  setConfigDir,
} from "../src/config.js";

describe("config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oac-test-"));
    setConfigDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadConfig returns empty services when no config file exists", () => {
    const config = loadConfig();
    expect(config).toEqual({ services: {} });
  });

  it("addService writes config and can be read back", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
      headers: { Authorization: "Bearer token" },
    });

    const svc = getService("diary");
    expect(svc).toBeDefined();
    expect(svc!.url).toBe("http://localhost:3499");
    expect(svc!.openapi).toBe("http://localhost:3499/docs/json");
    expect(svc!.headers?.Authorization).toBe("Bearer token");
  });

  it("addService throws on duplicate service name", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    });

    expect(() =>
      addService("diary", {
        url: "http://localhost:3500",
        openapi: "http://localhost:3500/docs/json",
      }),
    ).toThrow(/already exists/);
  });

  it("updateService does partial merge", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
      headers: { Authorization: "Bearer old" },
    });

    updateService("diary", { headers: { Authorization: "Bearer new" } });

    const svc = getService("diary");
    expect(svc!.url).toBe("http://localhost:3499");
    expect(svc!.headers?.Authorization).toBe("Bearer new");
  });

  it("updateService throws for non-existent service", () => {
    expect(() => updateService("nope", { url: "http://x" })).toThrow(/not found/);
  });

  it("removeService deletes the service", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    });

    removeService("diary");
    expect(getService("diary")).toBeUndefined();
  });

  it("removeService throws for non-existent service", () => {
    expect(() => removeService("nope")).toThrow(/not found/);
  });

  it("converts relative openapi path to absolute on addService", () => {
    const cwd = process.cwd();
    addService("note", {
      url: "http://localhost:3500",
      openapi: "./note-spec.json",
    });

    const svc = getService("note");
    expect(svc!.openapi).toBe(join(cwd, "note-spec.json"));
  });

  it("converts relative openapi path to absolute on updateService", () => {
    const cwd = process.cwd();
    addService("note", {
      url: "http://localhost:3500",
      openapi: "http://localhost:3500/docs/json",
    });

    updateService("note", { openapi: "./new-spec.json" });

    const svc = getService("note");
    expect(svc!.openapi).toBe(join(cwd, "new-spec.json"));
  });

  it("does not modify remote URL openapi paths", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "https://example.com/docs/json",
    });

    const svc = getService("diary");
    expect(svc!.openapi).toBe("https://example.com/docs/json");
  });

  it("saveConfig and loadConfig roundtrip", () => {
    const config = {
      services: {
        diary: {
          url: "http://localhost:3499",
          openapi: "http://localhost:3499/docs/json",
        },
      },
    };
    saveConfig(config);
    const loaded = loadConfig();
    expect(loaded).toEqual(config);
  });

  it("addService stores ignore patterns", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
      ignore: ["/api/auth/**", "/api/internal/**"],
    });

    const svc = getService("diary");
    expect(svc!.ignore).toEqual(["/api/auth/**", "/api/internal/**"]);
  });

  it("updateService merges ignore patterns", () => {
    addService("diary", {
      url: "http://localhost:3499",
      openapi: "http://localhost:3499/docs/json",
    });

    updateService("diary", { ignore: ["/api/debug/**"] });

    const svc = getService("diary");
    expect(svc!.ignore).toEqual(["/api/debug/**"]);
    expect(svc!.url).toBe("http://localhost:3499");
  });
});
