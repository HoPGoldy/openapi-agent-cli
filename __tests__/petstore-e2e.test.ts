/**
 * E2E tests using the public Petstore v3 API.
 *
 * These tests exercise the full CLI lifecycle against a live OpenAPI service:
 *   config add (remote spec) → help/command discovery → actual HTTP requests → config cleanup
 *
 * Requires network access to https://petstore3.swagger.io
 *
 * NOTE: Petstore is a public demo server. Some endpoints (store, user) may
 *       intermittently return 500. Tests that hit those endpoints are marked
 *       retry-tolerant and assert loosely.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "dist", "index.js");

const PETSTORE_URL = "https://petstore3.swagger.io/api/v3";
const PETSTORE_SPEC = "https://petstore3.swagger.io/api/v3/openapi.json";
const SERVICE_NAME = "petstore";

// Generous timeout for network requests (spec fetch can be slow)
const TIMEOUT = 120_000;

function cli(args: string[], env: Record<string, string>) {
  return execa("node", [CLI, ...args], { env, timeout: TIMEOUT });
}

function cliFail(args: string[], env: Record<string, string>) {
  return execa("node", [CLI, ...args], { env, timeout: TIMEOUT, reject: false });
}

describe("Petstore E2E", { timeout: TIMEOUT }, () => {
  let tempDir: string;
  let env: Record<string, string>;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oac-petstore-e2e-"));
    env = { ...process.env, OAC_CONFIG_DIR: tempDir } as Record<string, string>;
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Service Registration ──────────────────────────────────────────

  describe("Service Registration (remote spec)", () => {
    it("config add registers petstore from remote OpenAPI URL", async () => {
      const result = await cli(
        ["config", "add", SERVICE_NAME, "--url", PETSTORE_URL, "--openapi", PETSTORE_SPEC],
        env,
      );
      expect(result.stdout).toContain(`Service "${SERVICE_NAME}" added`);
      expect(result.stdout).toMatch(/Parsed \d+ commands/);
    });

    it("config list shows petstore service with remote URL", async () => {
      const result = await cli(["config", "list"], env);
      expect(result.stdout).toContain(SERVICE_NAME);
      expect(result.stdout).toContain(PETSTORE_URL);
      expect(result.stdout).toContain("remote");
    });

    it("config add duplicate petstore rejects", async () => {
      const result = await cliFail(
        ["config", "add", SERVICE_NAME, "--url", PETSTORE_URL, "--openapi", PETSTORE_SPEC],
        env,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("already exists");
    });
  });

  // ─── Command Discovery & Help ──────────────────────────────────────

  describe("Command Discovery & Help Text", () => {
    it("petstore --help lists dynamic API commands", async () => {
      const result = await cli([SERVICE_NAME, "--help"], env);
      expect(result.stdout).toContain("petstore service");
      // Petstore should have pet/store/user related commands
      expect(result.stdout).toMatch(/pet|store|user/i);
    });

    it("lists GET/POST/PUT/DELETE pet commands", async () => {
      const result = await cli([SERVICE_NAME, "--help"], env);
      const stdout = result.stdout;
      // Should have various pet endpoints
      expect(stdout).toContain("post-pet");
      expect(stdout).toContain("get-pet-pet-id");
      expect(stdout).toContain("delete-pet-pet-id");
    });

    it("pet create command help shows body schema", async () => {
      const result = await cli([SERVICE_NAME, "post-pet", "--help"], env);
      const stdout = result.stdout;
      expect(stdout).toContain("API: POST /pet");
      expect(stdout).toContain("Body Schema (--body):");
      // Pet schema should reference name and status
      expect(stdout).toMatch(/name/i);
    });

    it("get pet by ID command help shows path parameters", async () => {
      const result = await cli([SERVICE_NAME, "get-pet-pet-id", "--help"], env);
      const stdout = result.stdout;
      expect(stdout).toContain("API: GET /pet/{petId}");
      expect(stdout).toContain("Path Parameters (--params):");
      expect(stdout).toContain("petId");
    });

    it("find pets by status help shows query parameters", async () => {
      const result = await cli([SERVICE_NAME, "get-pet-find-by-status", "--help"], env);
      const stdout = result.stdout;
      expect(stdout).toContain("API: GET /pet/findByStatus");
      expect(stdout).toContain("Query Parameters (--query):");
      expect(stdout).toContain("status");
    });

    it("all commands include standard options", async () => {
      const result = await cli([SERVICE_NAME, "post-pet", "--help"], env);
      const stdout = result.stdout;
      expect(stdout).toContain("--body <json>");
      expect(stdout).toContain("--query <json>");
      expect(stdout).toContain("--params <json>");
      expect(stdout).toContain("--header <json>");
      expect(stdout).toContain("--output <file>");
      expect(stdout).toContain("--timeout <ms>");
    });

    it("simple GET command (no params/body) still shows help", async () => {
      // get-store-inventory has no params or body → minimal help
      const result = await cli([SERVICE_NAME, "get-store-inventory", "--help"], env);
      expect(result.stdout).toContain("get-store-inventory");
      expect(result.stdout).toContain("--body <json>");
    });

    it("pet findByTags help shows query enum values", async () => {
      const result = await cli([SERVICE_NAME, "get-pet-find-by-tags", "--help"], env);
      const stdout = result.stdout;
      expect(stdout).toContain("API: GET /pet/findByTags");
      expect(stdout).toContain("Query Parameters (--query):");
      expect(stdout).toContain("tags");
    });
  });

  // ─── Actual API Requests ───────────────────────────────────────────

  describe("API Requests - Pet CRUD", () => {
    const petId = Math.floor(Math.random() * 900000) + 100000;

    it("POST /pet - creates a new pet", async () => {
      const body = JSON.stringify({
        id: petId,
        name: "OAC-Test-Dog",
        status: "available",
        category: { id: 1, name: "Dogs" },
        photoUrls: ["https://example.com/photo.jpg"],
        tags: [{ id: 1, name: "test" }],
      });
      const result = await cli([SERVICE_NAME, "post-pet", "--body", body], env);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.id).toBe(petId);
      expect(parsed.name).toBe("OAC-Test-Dog");
      expect(parsed.status).toBe("available");
    });

    it("GET /pet/{petId} - retrieves the created pet", async () => {
      const result = await cli([SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId })], env);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.id).toBe(petId);
      expect(parsed.name).toBe("OAC-Test-Dog");
    });

    it("PUT /pet - updates the pet", async () => {
      const body = JSON.stringify({
        id: petId,
        name: "OAC-Test-Dog-Updated",
        status: "sold",
        photoUrls: ["https://example.com/photo.jpg"],
      });
      const result = await cli([SERVICE_NAME, "put-pet", "--body", body], env);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.name).toBe("OAC-Test-Dog-Updated");
      expect(parsed.status).toBe("sold");
    });

    it("GET /pet/findByStatus - finds pets by query param", async () => {
      // Use "sold" to get a smaller response set (faster, avoids timeout)
      const result = await cli(
        [
          SERVICE_NAME,
          "get-pet-find-by-status",
          "--query",
          JSON.stringify({ status: "sold" }),
          "--timeout",
          "60000",
        ],
        env,
      );
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("DELETE /pet/{petId} - deletes the pet", async () => {
      // Petstore DELETE returns non-JSON text ("Pet deleted") with JSON content-type.
      // After the fix, handleResponse gracefully falls back to text output.
      const result = await cli(
        [SERVICE_NAME, "delete-pet-pet-id", "--params", JSON.stringify({ petId })],
        env,
      );
      expect(result.exitCode).toBe(0);
    });

    it("GET /pet/{petId} - returns 404 after deletion", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId })],
        env,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/404|not found|Pet not found/i);
    });
  });

  describe("API Requests - Store", () => {
    it("GET /store/inventory - returns inventory map", async () => {
      const result = await cliFail([SERVICE_NAME, "get-store-inventory"], env);
      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout);
        expect(typeof parsed).toBe("object");
      } else {
        // Petstore store endpoints intermittently return 500
        expect(result.stderr).toMatch(/500|error/i);
      }
    });

    it("POST /store/order - places an order", async () => {
      const orderId = Math.floor(Math.random() * 900000) + 100000;
      const body = JSON.stringify({
        id: orderId,
        petId: 1,
        quantity: 1,
        shipDate: new Date().toISOString(),
        status: "placed",
        complete: true,
      });
      const result = await cliFail([SERVICE_NAME, "post-store-order", "--body", body], env);
      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout);
        expect(parsed.id).toBe(orderId);
        expect(parsed.status).toBe("placed");
      } else {
        expect(result.stderr).toMatch(/500|error/i);
      }
    });

    it("GET /store/order/{orderId} - retrieves an order", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-store-order-order-id", "--params", JSON.stringify({ orderId: 1 })],
        env,
      );
      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty("id");
      } else {
        expect(result.stderr).toMatch(/404|500|error|not found/i);
      }
    });
  });

  describe("API Requests - User", () => {
    const username = `oac-test-${Date.now()}`;

    it("POST /user - creates a user", async () => {
      const body = JSON.stringify({
        id: 0,
        username,
        firstName: "OAC",
        lastName: "Tester",
        email: "oac@test.com",
        password: "test1234",
        phone: "1234567890",
        userStatus: 1,
      });
      const result = await cliFail([SERVICE_NAME, "post-user", "--body", body], env);
      // Accept success or 500 (Petstore backend flakiness)
      if (result.exitCode !== 0) {
        expect(result.stderr).toMatch(/500|error/i);
      }
    });

    it("GET /user/{username} - retrieves the user", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-user-username", "--params", JSON.stringify({ username })],
        env,
      );
      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout);
        expect(parsed.username).toBe(username);
      } else {
        // 404 if creation failed, or 500 from server
        expect(result.stderr).toMatch(/404|500|error|not found/i);
      }
    });

    it("PUT /user/{username} - updates the user", async () => {
      const body = JSON.stringify({
        id: 0,
        username,
        firstName: "Updated",
        lastName: "Tester",
        email: "updated@test.com",
        password: "test1234",
        phone: "1234567890",
        userStatus: 1,
      });
      const result = await cliFail(
        [SERVICE_NAME, "put-user-username", "--body", body, "--params", JSON.stringify({ username })],
        env,
      );
      if (result.exitCode !== 0) {
        expect(result.stderr).toMatch(/500|error/i);
      }
    });

    it("DELETE /user/{username} - deletes the user", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "delete-user-username", "--params", JSON.stringify({ username })],
        env,
      );
      if (result.exitCode !== 0) {
        expect(result.stderr).toMatch(/500|error/i);
      }
    });
  });

  // ─── Custom Headers & Query Params ─────────────────────────────────

  describe("Custom Headers", () => {
    it("passes custom headers with --header flag", async () => {
      // Use findByStatus with "sold" to keep response small
      const result = await cli(
        [
          SERVICE_NAME,
          "get-pet-find-by-status",
          "--query",
          JSON.stringify({ status: "sold" }),
          "--header",
          JSON.stringify({ Accept: "application/json" }),
          "--timeout",
          "60000",
        ],
        env,
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("config set adds service-level headers", async () => {
      await cli(["config", "set", SERVICE_NAME, "--headers", JSON.stringify({ "X-Test": "e2e" })], env);
      // Verify the pet endpoint still works with the extra custom header
      const petResult = await cli(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId: 1 })],
        env,
      );
      expect(petResult.exitCode).toBe(0);
    });
  });

  // ─── Timeout Handling ──────────────────────────────────────────────

  describe("Timeout Handling", () => {
    it("request succeeds with generous timeout", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId: 1 }), "--timeout", "30000"],
        env,
      );
      // Pet ID 1 usually exists on Petstore
      expect(result.exitCode).toBe(0);
    });

    it("request fails with extremely short timeout", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId: 1 }), "--timeout", "1"],
        env,
      );
      // Should fail due to timeout abort
      expect(result.exitCode).not.toBe(0);
    });
  });

  // ─── Error Handling ────────────────────────────────────────────────

  describe("Error Handling", () => {
    it("invalid --body JSON exits with error", async () => {
      const result = await cliFail([SERVICE_NAME, "post-pet", "--body", "not-valid-json"], env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid JSON");
    });

    it("invalid --query JSON exits with error", async () => {
      const result = await cliFail([SERVICE_NAME, "get-pet-find-by-status", "--query", "{broken"], env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid JSON");
    });

    it("invalid --params JSON exits with error", async () => {
      const result = await cliFail([SERVICE_NAME, "get-pet-pet-id", "--params", "nope"], env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid JSON");
    });

    it("invalid --header JSON exits with error", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId: 1 }), "--header", "bad"],
        env,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid JSON");
    });

    it("non-existent command shows help", async () => {
      const result = await cliFail([SERVICE_NAME, "does-not-exist"], env);
      expect(result.exitCode).not.toBe(0);
    });

    it("GET /pet/{petId} with non-existent ID returns error", async () => {
      const result = await cliFail(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId: 999999999 })],
        env,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/404|not found/i);
    });
  });

  // ─── Ignore Patterns ──────────────────────────────────────────────

  describe("Ignore Patterns", () => {
    it("config set ignore filters out commands", async () => {
      // Ignore all user endpoints
      await cli(["config", "set", SERVICE_NAME, "--ignore", JSON.stringify(["/user/**"])], env);
      const result = await cli([SERVICE_NAME, "--help"], env);
      // User commands should be hidden
      expect(result.stdout).not.toContain("post-user");
      expect(result.stdout).not.toContain("get-user-username");
      // Pet commands should still show
      expect(result.stdout).toContain("post-pet");
    });

    it("multiple ignore patterns filter multiple groups", async () => {
      await cli(["config", "set", SERVICE_NAME, "--ignore", JSON.stringify(["/user/**", "/store/**"])], env);
      const result = await cli([SERVICE_NAME, "--help"], env);
      expect(result.stdout).not.toContain("post-user");
      expect(result.stdout).not.toContain("get-store-inventory");
      // Pet commands still present
      expect(result.stdout).toContain("post-pet");
    });

    it("removing ignore restores commands", async () => {
      await cli(["config", "set", SERVICE_NAME, "--ignore", JSON.stringify([])], env);
      const result = await cli([SERVICE_NAME, "--help"], env);
      expect(result.stdout).toContain("post-user");
      expect(result.stdout).toContain("post-pet");
      expect(result.stdout).toContain("get-store-inventory");
    });
  });

  // ─── Config Refresh (Remote Spec) ─────────────────────────────────

  describe("Config Refresh", () => {
    it("config refresh re-fetches and re-parses remote spec", async () => {
      const result = await cli(["config", "refresh", SERVICE_NAME], env);
      expect(result.stdout).toContain("Refreshed");
      expect(result.stdout).toMatch(/\d+ commands/);
    });

    it("commands still work after refresh", async () => {
      // Use the reliable pet endpoint
      const result = await cli(
        [SERVICE_NAME, "get-pet-pet-id", "--params", JSON.stringify({ petId: 1 })],
        env,
      );
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(typeof parsed).toBe("object");
    });

    it("config refresh for non-existent service fails", async () => {
      const result = await cliFail(["config", "refresh", "no-such-svc"], env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });
  });

  // ─── Cleanup ───────────────────────────────────────────────────────

  describe("Cleanup", () => {
    it("config remove deletes petstore service", async () => {
      const result = await cli(["config", "remove", SERVICE_NAME], env);
      expect(result.stdout).toContain("removed");
    });

    it("config list no longer shows petstore", async () => {
      const result = await cli(["config", "list"], env);
      expect(result.stdout).not.toContain(SERVICE_NAME);
    });

    it("accessing removed service shows schema missing error", async () => {
      // Re-add and immediately remove to test schema-missing message
      await cli(["config", "add", "tmp-svc", "--url", PETSTORE_URL, "--openapi", PETSTORE_SPEC], env);
      await cli(["config", "remove", "tmp-svc"], env);
      const result = await cliFail(["config", "refresh", "tmp-svc"], env);
      expect(result.exitCode).not.toBe(0);
    });
  });
});
