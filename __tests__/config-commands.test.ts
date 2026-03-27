import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { setConfigDir, getService } from "../src/config.js";
import { setSchemaDir } from "../src/spec-parser.js";
import { setCacheDir } from "../src/spec-loader.js";
import { registerConfigCommands } from "../src/config-commands.js";

// Mock spec-loader to avoid actual network calls
vi.mock("../src/spec-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/spec-loader.js")>();
  return {
    ...original,
    fetchSpec: vi.fn().mockResolvedValue({
      openapi: "3.0.0",
      info: { title: "Mock", version: "1.0" },
      paths: {
        "/api/test": {
          get: { description: "Test endpoint" },
        },
      },
    }),
  };
});

describe("registerConfigCommands", () => {
  let tempDir: string;
  let logSpy: any;
  let stderrSpy: any;
  let exitSpy: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oac-cmd-test-"));
    const cacheDir = join(tempDir, "cache");
    mkdirSync(cacheDir, { recursive: true });
    setConfigDir(tempDir);
    setSchemaDir(cacheDir);
    setCacheDir(cacheDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("config add registers a new service", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "test-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Service "test-svc" added'));
  });

  it("config add rejects duplicate service", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "dup-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    const program2 = new Command();
    registerConfigCommands(program2);

    await expect(
      program2.parseAsync(
        [
          "config",
          "add",
          "dup-svc",
          "--url",
          "http://localhost:3499",
          "--openapi",
          "http://localhost:3499/docs/json",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("process.exit");

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("config list shows configured services", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "list-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    const program2 = new Command();
    registerConfigCommands(program2);

    await program2.parseAsync(["config", "list"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("list-svc"));
  });

  it("config set updates service config", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "set-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    const program2 = new Command();
    registerConfigCommands(program2);

    await program2.parseAsync(["config", "set", "set-svc", "--headers", '{"Authorization":"Bearer new"}'], {
      from: "user",
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("updated"));
  });

  it("config remove deletes service", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "rm-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    const program2 = new Command();
    registerConfigCommands(program2);

    await program2.parseAsync(["config", "remove", "rm-svc"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("removed"));
  });

  it("config refresh re-fetches spec", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "ref-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    const program2 = new Command();
    registerConfigCommands(program2);

    await program2.parseAsync(["config", "refresh", "ref-svc"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Refreshed"));
  });

  it("config add with --ignore stores ignore patterns", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "ign-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
        "--ignore",
        '["/api/auth/**", "/api/internal/**"]',
      ],
      { from: "user" },
    );

    const svc = getService("ign-svc");
    expect(svc!.ignore).toEqual(["/api/auth/**", "/api/internal/**"]);
  });

  it("config set with --ignore updates ignore patterns", async () => {
    const program = new Command();
    registerConfigCommands(program);

    await program.parseAsync(
      [
        "config",
        "add",
        "ign-set-svc",
        "--url",
        "http://localhost:3499",
        "--openapi",
        "http://localhost:3499/docs/json",
      ],
      { from: "user" },
    );

    const program2 = new Command();
    registerConfigCommands(program2);

    await program2.parseAsync(["config", "set", "ign-set-svc", "--ignore", '["/api/debug/**"]'], {
      from: "user",
    });

    const svc = getService("ign-set-svc");
    expect(svc!.ignore).toEqual(["/api/debug/**"]);
  });
});
