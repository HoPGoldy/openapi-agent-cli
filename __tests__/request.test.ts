import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiRequest, apiUpload, apiFormRequest, apiRawRequest } from "../src/request.js";
import type { ServiceConfig } from "../src/config.js";

const baseConfig: ServiceConfig = {
  url: "http://localhost:3499",
  openapi: "http://localhost:3499/docs/json",
  headers: { Authorization: "Bearer token" },
};

describe("apiRequest", () => {
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON response", async () => {
    const responseData = { code: 200, data: [{ id: 1 }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiRequest(baseConfig, "POST", "/api/test", { key: "value" });
    expect(result).toEqual(responseData);
  });

  it("appends query params to URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest(baseConfig, "GET", "/api/test", undefined, { page: 1, size: 10 });

    const calledUrl = fetchSpy.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toContain("page=1");
    expect(calledUrl.toString()).toContain("size=10");
  });

  it("merges config headers with custom headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest(baseConfig, "GET", "/api/test", undefined, undefined, {
      "X-Custom": "custom-value",
    });

    const calledHeaders = (fetchSpy.mock.calls[0][1] as any).headers;
    expect(calledHeaders.Authorization).toBe("Bearer token");
    expect(calledHeaders["X-Custom"]).toBe("custom-value");
  });

  it("outputs error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    await expect(apiRequest(baseConfig, "GET", "/api/missing")).rejects.toThrow("process.exit called");

    expect(stderrSpy).toHaveBeenCalledWith("✗ [404] Not Found");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("handles text response", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Hello text", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = await apiRequest(baseConfig, "GET", "/api/text");
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("Hello text");
  });

  it("saves binary response to output file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oac-req-test-"));
    const outputPath = join(tempDir, "downloaded.bin");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(binaryData, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    const result = await apiRequest(
      baseConfig,
      "GET",
      "/api/download",
      undefined,
      undefined,
      undefined,
      30000,
      outputPath,
    );

    expect(result).toBeNull();
    expect(readFileSync(outputPath)).toEqual(binaryData);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("✓ Saved to"));

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts filename from Content-Disposition", async () => {
    const repoRoot = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), "oac-req-test-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    process.chdir(tempDir);

    const binaryData = Buffer.from([1, 2, 3]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(binaryData, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="photo.jpg"',
        },
      }),
    );

    const result = await apiRequest(baseConfig, "GET", "/api/download");
    try {
      expect(result).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("photo.jpg"));
      expect(existsSync(join(tempDir, "photo.jpg"))).toBe(true);
      expect(existsSync(join(repoRoot, "photo.jpg"))).toBe(false);
    } finally {
      process.chdir(repoRoot);
      rmSync(join(repoRoot, "photo.jpg"), { force: true });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("sets timeout via AbortSignal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiRequest(baseConfig, "GET", "/api/test", undefined, undefined, undefined, 5000);

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.signal).toBeDefined();
  });

  it("falls back to text when content-type says JSON but body is not valid JSON", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Pet deleted", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiRequest(baseConfig, "DELETE", "/api/pet/1");
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("Pet deleted");
  });
});

describe("apiUpload", () => {
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends FormData with binary field from file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oac-upload-test-"));
    const testFile = join(tempDir, "test.txt");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(testFile, "file content");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiUpload(
      baseConfig,
      "/api/upload",
      { file: testFile, description: "test file" },
      new Set(["file"]),
    );

    expect(result).toEqual({ id: "abc123" });

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.body).toBeInstanceOf(FormData);

    // Verify headers don't include Content-Type (let fetch set it with boundary)
    expect(calledOpts.headers["Content-Type"]).toBeUndefined();
    expect(calledOpts.headers.Authorization).toBe("Bearer token");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends non-string fields as JSON.stringify", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiUpload(baseConfig, "/api/upload", { tags: ["a", "b"], count: 3 }, new Set<string>());

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.body).toBeInstanceOf(FormData);
  });

  it("merges config headers with custom headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiUpload(baseConfig, "/api/upload", { name: "test" }, new Set<string>(), undefined, {
      "X-Custom": "value",
    });

    const calledHeaders = (fetchSpy.mock.calls[0][1] as any).headers;
    expect(calledHeaders.Authorization).toBe("Bearer token");
    expect(calledHeaders["X-Custom"]).toBe("value");
  });

  it("outputs error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Server Error", { status: 500 }));

    await expect(apiUpload(baseConfig, "/api/upload", { name: "test" }, new Set<string>())).rejects.toThrow(
      "process.exit called",
    );

    expect(stderrSpy).toHaveBeenCalledWith("✗ [500] Server Error");
  });

  it("appends query params to upload URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiUpload(baseConfig, "/api/upload", { name: "test" }, new Set<string>(), { folder: "docs" });

    const calledUrl = fetchSpy.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toContain("folder=docs");
  });

  it("handles text response from upload", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Upload complete", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = await apiUpload(baseConfig, "/api/upload", { name: "test" }, new Set<string>());
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("Upload complete");
  });

  it("falls back to text when upload response claims JSON but is not", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiUpload(baseConfig, "/api/upload", { name: "test" }, new Set<string>());
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("OK");
  });
});

describe("apiFormRequest", () => {
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends body as URL-encoded form data", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiFormRequest(baseConfig, "POST", "/api/login", {
      username: "admin",
      password: "secret",
    });

    expect(result).toEqual({ ok: true });

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calledOpts.body).toContain("username=admin");
    expect(calledOpts.body).toContain("password=secret");
  });

  it("stringifies non-string values in form body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiFormRequest(baseConfig, "POST", "/api/form", { count: 5, tags: ["a", "b"] });

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.body).toContain("count=5");
    expect(calledOpts.body).toContain("tags=");
  });

  it("appends query params to URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiFormRequest(baseConfig, "POST", "/api/form", { key: "val" }, { extra: "param" });

    const calledUrl = fetchSpy.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toContain("extra=param");
  });

  it("outputs error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Bad Request", { status: 400 }));

    await expect(apiFormRequest(baseConfig, "POST", "/api/form", { key: "val" })).rejects.toThrow(
      "process.exit called",
    );
    expect(stderrSpy).toHaveBeenCalledWith("✗ [400] Bad Request");
  });

  it("handles text response from form submission", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Login successful", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = await apiFormRequest(baseConfig, "POST", "/api/login", { user: "admin" });
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("Login successful");
  });

  it("falls back to text when form response claims JSON but is not", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Success", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiFormRequest(baseConfig, "POST", "/api/form", { key: "val" });
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("Success");
  });
});

describe("apiRawRequest", () => {
  let exitSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends raw XML body with correct Content-Type", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<result>ok</result>", {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const xmlBody = "<request><id>1</id></request>";
    const result = await apiRawRequest(baseConfig, "POST", "/api/xml", "application/xml", xmlBody);

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("<result>ok</result>");

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.headers["Content-Type"]).toBe("application/xml");
    expect(calledOpts.body).toBe(xmlBody);
  });

  it("returns parsed JSON when response is JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiRawRequest(baseConfig, "POST", "/api/raw", "text/plain", "hello");
    expect(result).toEqual({ status: "ok" });
  });

  it("sends raw text body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("received", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await apiRawRequest(baseConfig, "POST", "/api/text", "text/plain", "plain text content");

    const calledOpts = fetchSpy.mock.calls[0][1] as any;
    expect(calledOpts.headers["Content-Type"]).toBe("text/plain");
    expect(calledOpts.body).toBe("plain text content");
    expect(logSpy).toHaveBeenCalledWith("received");
  });

  it("outputs error on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Server Error", { status: 500 }));

    await expect(apiRawRequest(baseConfig, "POST", "/api/raw", "application/xml", "<data/>")).rejects.toThrow(
      "process.exit called",
    );
    expect(stderrSpy).toHaveBeenCalledWith("✗ [500] Server Error");
  });

  it("falls back to text when raw response claims JSON but is not", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Accepted", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await apiRawRequest(baseConfig, "POST", "/api/raw", "application/xml", "<data/>");
    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalledWith("Accepted");
  });
});
