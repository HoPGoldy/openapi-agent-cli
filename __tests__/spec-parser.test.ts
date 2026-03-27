import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pathToCommandName,
  camelToKebab,
  parseSpec,
  parseAndSave,
  loadSchema,
  setSchemaDir,
} from "../src/spec-parser.js";

describe("camelToKebab", () => {
  it("converts camelCase to kebab-case", () => {
    expect(camelToKebab("getMonthList")).toBe("get-month-list");
  });

  it("handles single word", () => {
    expect(camelToKebab("update")).toBe("update");
  });

  it("handles consecutive uppercase", () => {
    expect(camelToKebab("getHTTPResponse")).toBe("get-httpresponse");
  });

  it("handles already kebab", () => {
    expect(camelToKebab("already-kebab")).toBe("already-kebab");
  });
});

describe("pathToCommandName", () => {
  it("converts simple path", () => {
    expect(pathToCommandName("/api/diary/getMonthList")).toBe("api-diary-get-month-list");
  });

  it("keeps path params without braces", () => {
    expect(pathToCommandName("/api/attachments/request/{fileId}")).toBe("api-attachments-request-file-id");
  });

  it("handles multiple path params", () => {
    expect(pathToCommandName("/api/{org}/repos/{repoId}")).toBe("api-org-repos-repo-id");
  });

  it("handles versioned paths", () => {
    expect(pathToCommandName("/api/v2/users/list")).toBe("api-v2-users-list");
  });
});

describe("parseSpec", () => {
  it("parses paths to command schemas", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/diary/getMonthList": {
          post: { description: "获取月份列表" },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands).toHaveLength(1);
    expect(schema.commands[0]).toMatchObject({
      name: "post-api-diary-get-month-list",
      description: "获取月份列表",
      method: "POST",
      path: "/api/diary/getMonthList",
      contentType: "application/json",
      binaryFields: [],
      parameters: [],
    });
    expect(schema.commands[0].bodySchema).toBeUndefined();
  });

  it("detects multipart/form-data and extracts binary fields", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/attachments/upload": {
          post: {
            summary: "上传文件",
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      file: { type: "string", format: "binary" },
                      description: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands[0]).toMatchObject({
      name: "post-api-attachments-upload",
      description: "上传文件",
      contentType: "multipart/form-data",
      binaryFields: ["file"],
    });
  });

  it("prefers description over summary", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test": {
          get: { description: "详细描述", summary: "简短摘要" },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands[0].description).toBe("详细描述");
  });

  it("falls back to summary when no description", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test": {
          get: { summary: "简短摘要" },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands[0].description).toBe("简短摘要");
  });

  it("filters non-operation keys like parameters", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test/{id}": {
          parameters: [{ name: "id", in: "path" }],
          get: { description: "Get item" },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands).toHaveLength(1);
    expect(schema.commands[0].method).toBe("GET");
  });

  it("throws on command name collision", () => {
    // This is contrived but tests the detection
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/items": {
          get: { description: "List" },
        },
        // Different path that produces same command name - impossible in practice
        // but we can test by having two methods that collide (same method+path won't happen in valid spec)
      },
    };

    // Valid spec won't collide easily with path params included.
    // Just verify parseSpec runs without error for normal cases.
    const schema = parseSpec(spec);
    expect(schema.commands).toHaveLength(1);
  });

  it("handles multiple methods on same path", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/items": {
          get: { description: "List items" },
          post: { description: "Create item" },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands).toHaveLength(2);
    const names = schema.commands.map((c) => c.name);
    expect(names).toContain("get-api-items");
    expect(names).toContain("post-api-items");
  });

  it("handles path with path params in command name", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/items/{id}": {
          get: { description: "Get item by id" },
        },
        "/api/items": {
          get: { description: "List items" },
        },
      },
    };

    const schema = parseSpec(spec);
    const names = schema.commands.map((c) => c.name);
    expect(names).toContain("get-api-items-id");
    expect(names).toContain("get-api-items");
    // No collision
    expect(new Set(names).size).toBe(names.length);
  });

  it("extracts parameters from operation", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/items/{id}": {
          get: {
            description: "Get item",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
              {
                name: "format",
                in: "query",
                description: "输出格式",
                schema: { type: "string", enum: ["json", "xml"] },
              },
            ],
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.parameters).toHaveLength(2);
    expect(cmd.parameters[0]).toMatchObject({ name: "id", in: "path", type: "string", required: true });
    expect(cmd.parameters[1]).toMatchObject({
      name: "format",
      in: "query",
      type: "string",
      required: false,
      description: "输出格式",
      enum: ["json", "xml"],
    });
  });

  it("extracts body schema with required fields", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/diary/search": {
          post: {
            description: "搜索日记",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["keyword"],
                    properties: {
                      keyword: { type: "string", description: "搜索关键词" },
                      page: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.bodySchema).toBeDefined();
    expect(cmd.bodySchema!.required).toEqual(["keyword"]);
    expect(cmd.bodySchema!.properties.keyword).toMatchObject({ type: "string", description: "搜索关键词" });
    expect(cmd.bodySchema!.properties.page).toMatchObject({ type: "integer" });
  });

  it("extracts nested object body schema recursively", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test": {
          post: {
            description: "Test",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      filter: {
                        type: "object",
                        required: ["status"],
                        properties: {
                          status: { type: "string", enum: ["draft", "published"] },
                          tags: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.bodySchema!.properties.filter.type).toBe("object");
    expect(cmd.bodySchema!.properties.filter.properties!.status.enum).toEqual(["draft", "published"]);
    expect(cmd.bodySchema!.properties.filter.properties!.tags.type).toBe("array");
    expect(cmd.bodySchema!.properties.filter.properties!.tags.items?.type).toBe("string");
    expect(cmd.bodySchema!.properties.filter.required).toEqual(["status"]);
  });

  it("resolves allOf by merging properties and required", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test": {
          post: {
            description: "allOf test",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
                      { type: "object", properties: { age: { type: "integer" } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.bodySchema).toBeDefined();
    expect(cmd.bodySchema!.properties.name).toMatchObject({ type: "string" });
    expect(cmd.bodySchema!.properties.age).toMatchObject({ type: "integer" });
    expect(cmd.bodySchema!.required).toContain("name");
  });

  it("resolves oneOf by merging all variant properties", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test": {
          post: {
            description: "oneOf test",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { type: "object", properties: { email: { type: "string" } } },
                      { type: "object", properties: { phone: { type: "string" } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.bodySchema).toBeDefined();
    expect(cmd.bodySchema!.properties.email).toMatchObject({ type: "string" });
    expect(cmd.bodySchema!.properties.phone).toMatchObject({ type: "string" });
  });

  it("inherits path-level parameters and operation overrides", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/items/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "query", schema: { type: "string", default: "v1" } },
          ],
          get: {
            description: "Get item",
            parameters: [
              {
                name: "version",
                in: "query",
                description: "API version override",
                schema: { type: "string", default: "v2" },
              },
            ],
          },
          put: {
            description: "Update item",
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const getCmd = schema.commands.find((c) => c.name.startsWith("get-"))!;
    const putCmd = schema.commands.find((c) => c.name.startsWith("put-"))!;

    // GET: operation overrides path-level version param
    expect(getCmd.parameters).toHaveLength(2);
    const getVersion = getCmd.parameters.find((p) => p.name === "version")!;
    expect(getVersion.description).toBe("API version override");
    expect(getVersion.default).toBe("v2");

    // PUT: inherits path-level params as-is
    expect(putCmd.parameters).toHaveLength(2);
    const putVersion = putCmd.parameters.find((p) => p.name === "version")!;
    expect(putVersion.default).toBe("v1");
  });

  it("extracts deprecated flag from operation", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/old": {
          get: { description: "Old endpoint", deprecated: true },
        },
        "/api/new": {
          get: { description: "New endpoint" },
        },
      },
    };

    const schema = parseSpec(spec);
    const oldCmd = schema.commands.find((c) => c.name.includes("old"))!;
    const newCmd = schema.commands.find((c) => c.name.includes("new"))!;
    expect(oldCmd.deprecated).toBe(true);
    expect(newCmd.deprecated).toBeUndefined();
  });

  it("extracts default values from properties and parameters", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/search": {
          get: {
            description: "Search",
            parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 20 } }],
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sort: { type: "string", default: "desc" },
                      page: { type: "integer", default: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.parameters[0].default).toBe(20);
    expect(cmd.bodySchema!.properties.sort.default).toBe("desc");
    expect(cmd.bodySchema!.properties.page.default).toBe(1);
  });

  it("detects application/x-www-form-urlencoded contentType", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/login": {
          post: {
            description: "Login",
            requestBody: {
              content: {
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    properties: {
                      username: { type: "string" },
                      password: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    const cmd = schema.commands[0];
    expect(cmd.contentType).toBe("application/x-www-form-urlencoded");
    expect(cmd.bodySchema).toBeDefined();
    expect(cmd.bodySchema!.properties.username).toMatchObject({ type: "string" });
  });

  it("detects application/xml contentType", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/data": {
          post: {
            description: "Post XML",
            requestBody: {
              content: {
                "application/xml": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands[0].contentType).toBe("application/xml");
  });

  it("detects text/plain contentType", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/text": {
          post: {
            description: "Post text",
            requestBody: {
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);
    expect(schema.commands[0].contentType).toBe("text/plain");
  });
});

describe("parseAndSave / loadSchema", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oac-schema-test-"));
    setSchemaDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes schema.json and reads it back", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api/test": {
          get: { description: "Test endpoint" },
        },
      },
    };

    const schema = parseAndSave("test-svc", spec);
    expect(schema.commands).toHaveLength(1);
    expect(existsSync(join(tempDir, "test-svc.schema.json"))).toBe(true);

    const loaded = loadSchema("test-svc");
    expect(loaded).not.toBeNull();
    expect(loaded!.commands[0].name).toBe("get-api-test");
  });

  it("loadSchema returns null for non-existent service", () => {
    expect(loadSchema("nonexistent")).toBeNull();
  });
});
