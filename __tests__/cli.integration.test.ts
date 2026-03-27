import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa, type ExecaError } from "execa";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");
const FIXTURE = join(__dirname, "fixtures", "test-spec.json");

describe("CLI E2E", () => {
  let tempDir: string;
  let env: Record<string, string>;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oac-e2e-"));
    env = { ...process.env, OAC_CONFIG_DIR: tempDir } as Record<string, string>;
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("--help shows usage", async () => {
    const result = await execa("node", [CLI, "--help"], { env });
    expect(result.stdout).toContain("OpenAPI-driven CLI");
    expect(result.stdout).toContain("config");
  });

  it("--version shows version", async () => {
    const result = await execa("node", [CLI, "--version"], { env });
    expect(result.stdout).toContain("1.0.0");
  });

  it("config add registers a service from local fixture", async () => {
    const result = await execa(
      "node",
      [CLI, "config", "add", "test-svc", "--url", "http://localhost:9999", "--openapi", FIXTURE],
      { env },
    );
    expect(result.stdout).toContain('Service "test-svc" added');
    expect(result.stdout).toMatch(/Parsed \d+ commands/);
  });

  it("config add duplicate rejects with error", async () => {
    try {
      await execa(
        "node",
        [CLI, "config", "add", "test-svc", "--url", "http://localhost:9999", "--openapi", FIXTURE],
        { env },
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecaError;
      expect(e.exitCode).not.toBe(0);
      expect(e.stderr).toContain("already exists");
    }
  });

  it("config list shows the added service", async () => {
    const result = await execa("node", [CLI, "config", "list"], { env });
    expect(result.stdout).toContain("test-svc");
    expect(result.stdout).toContain("http://localhost:9999");
  });

  it("config set updates headers", async () => {
    const result = await execa(
      "node",
      [CLI, "config", "set", "test-svc", "--headers", '{"X-Custom":"value"}'],
      { env },
    );
    expect(result.stdout).toContain("updated");
  });

  it("test-svc --help shows dynamic commands", async () => {
    const result = await execa("node", [CLI, "test-svc", "--help"], { env });
    expect(result.stdout).toContain("test-svc service");
    // Should have commands from the fixture spec
    expect(result.stdout).toContain("api-diary-get-month-list");
    expect(result.stdout).toContain("api-attachments-upload");
  });

  it("config refresh re-parses spec", async () => {
    const result = await execa("node", [CLI, "config", "refresh", "test-svc"], { env });
    expect(result.stdout).toContain("Refreshed");
    expect(result.stdout).toMatch(/\d+ commands/);
  });

  it("config remove deletes the service", async () => {
    const result = await execa("node", [CLI, "config", "remove", "test-svc"], { env });
    expect(result.stdout).toContain("removed");
  });

  it("config refresh after remove fails", async () => {
    try {
      await execa("node", [CLI, "config", "refresh", "test-svc"], { env });
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecaError;
      expect(e.exitCode).not.toBe(0);
      expect(e.stderr).toContain("not found");
    }
  });
});
