import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { buildCommands, safeJsonParse } from "../src/command-builder.js";
import type { ServiceSchema } from "../src/spec-parser.js";
import type { ServiceConfig } from "../src/config.js";

const mockServiceConfig: ServiceConfig = {
  url: "http://localhost:3499",
  openapi: "http://localhost:3499/docs/json",
};

const testSchema: ServiceSchema = {
  generatedAt: Date.now(),
  commands: [
    {
      name: "post-api-diary-get-month-list",
      description: "获取指定月份的日记列表",
      method: "POST",
      path: "/api/diary/getMonthList",
      contentType: "application/json",
      binaryFields: [],
      parameters: [],
      bodySchema: {
        required: ["month"],
        properties: {
          month: { type: "string", description: "月份，格式 YYYY-MM" },
        },
      },
    },
    {
      name: "post-api-attachments-upload",
      description: "上传文件",
      method: "POST",
      path: "/api/attachments/upload",
      contentType: "multipart/form-data",
      binaryFields: ["file"],
      parameters: [],
    },
    {
      name: "get-api-items-id",
      description: "Get item by id",
      method: "GET",
      path: "/api/items/{id}",
      contentType: "application/json",
      binaryFields: [],
      parameters: [{ name: "id", in: "path", type: "string", required: true }],
    },
  ],
};

describe("safeJsonParse", () => {
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

  it("returns undefined for undefined input", () => {
    expect(safeJsonParse(undefined, "--body")).toBeUndefined();
  });

  it("parses valid JSON", () => {
    const result = safeJsonParse('{"key": "value"}', "--body");
    expect(result).toEqual({ key: "value" });
  });

  it("reports friendly error on invalid JSON", () => {
    expect(() => safeJsonParse("{invalid", "--body")).toThrow("process.exit called");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("✗ Invalid JSON in --body:"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("buildCommands", () => {
  it("registers correct number of subcommands", () => {
    const group = new Command("diary");
    buildCommands(group, testSchema, mockServiceConfig);

    expect(group.commands).toHaveLength(3);
  });

  it("registers commands with correct names and descriptions", () => {
    const group = new Command("diary");
    buildCommands(group, testSchema, mockServiceConfig);

    const names = group.commands.map((c) => c.name());
    expect(names).toContain("post-api-diary-get-month-list");
    expect(names).toContain("post-api-attachments-upload");
    expect(names).toContain("get-api-items-id");

    const cmd = group.commands.find((c) => c.name() === "post-api-diary-get-month-list");
    expect(cmd?.description()).toBe("获取指定月份的日记列表");
  });

  it("adds API detail help text for commands with parameters", () => {
    const group = new Command("test");
    buildCommands(group, testSchema, mockServiceConfig);

    const cmd = group.commands.find((c) => c.name() === "get-api-items-id")!;
    let helpOutput = "";
    cmd.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      },
    });
    cmd.outputHelp();
    expect(helpOutput).toContain("API: GET /api/items/{id}");
    expect(helpOutput).toContain("Path Parameters (--params)");
    expect(helpOutput).toContain("id");
  });

  it("adds body schema help text for commands with bodySchema", () => {
    const group = new Command("test");
    buildCommands(group, testSchema, mockServiceConfig);

    const cmd = group.commands.find((c) => c.name() === "post-api-diary-get-month-list")!;
    let helpOutput = "";
    cmd.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      },
    });
    cmd.outputHelp();
    expect(helpOutput).toContain("API: POST /api/diary/getMonthList");
    expect(helpOutput).toContain("Body Schema (--body)");
    expect(helpOutput).toContain("month");
    expect(helpOutput).toContain("(required)");
    expect(helpOutput).toContain("月份，格式 YYYY-MM");
  });

  it("does not add extra help text for commands without params or body", () => {
    const group = new Command("test");
    const minimalSchema: ServiceSchema = {
      generatedAt: Date.now(),
      commands: [
        {
          name: "post-api-test",
          description: "test",
          method: "POST",
          path: "/api/test",
          contentType: "application/json",
          binaryFields: [],
          parameters: [],
        },
      ],
    };
    buildCommands(group, minimalSchema, mockServiceConfig);

    const cmd = group.commands.find((c) => c.name() === "post-api-test")!;
    let helpOutput = "";
    cmd.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      },
    });
    cmd.outputHelp();
    expect(helpOutput).not.toContain("API:");
    expect(helpOutput).not.toContain("Body Schema");
  });

  it("registers all expected options on each subcommand", () => {
    const group = new Command("diary");
    buildCommands(group, testSchema, mockServiceConfig);

    const cmd = group.commands[0];
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--body");
    expect(optionNames).toContain("--query");
    expect(optionNames).toContain("--params");
    expect(optionNames).toContain("--header");
    expect(optionNames).toContain("--output");
    expect(optionNames).toContain("--timeout");
  });

  it("filters out commands matching ignore patterns", () => {
    const group = new Command("diary");
    const configWithIgnore: ServiceConfig = {
      ...mockServiceConfig,
      ignore: ["/api/attachments/**"],
    };
    buildCommands(group, testSchema, configWithIgnore);

    const names = group.commands.map((c) => c.name());
    expect(names).toContain("post-api-diary-get-month-list");
    expect(names).toContain("get-api-items-id");
    expect(names).not.toContain("post-api-attachments-upload");
  });

  it("filters out commands matching multiple ignore patterns", () => {
    const group = new Command("diary");
    const configWithIgnore: ServiceConfig = {
      ...mockServiceConfig,
      ignore: ["/api/attachments/**", "/api/items/**"],
    };
    buildCommands(group, testSchema, configWithIgnore);

    const names = group.commands.map((c) => c.name());
    expect(names).toContain("post-api-diary-get-month-list");
    expect(names).not.toContain("post-api-attachments-upload");
    expect(names).not.toContain("get-api-items-id");
  });

  it("does not filter when ignore is undefined", () => {
    const group = new Command("diary");
    buildCommands(group, testSchema, mockServiceConfig);

    expect(group.commands).toHaveLength(3);
  });

  it("does not filter when ignore is empty array", () => {
    const group = new Command("diary");
    const configWithEmptyIgnore: ServiceConfig = {
      ...mockServiceConfig,
      ignore: [],
    };
    buildCommands(group, testSchema, configWithEmptyIgnore);

    expect(group.commands).toHaveLength(3);
  });

  it("shows [DEPRECATED] prefix and warning in help for deprecated commands", () => {
    const group = new Command("test");
    const deprecatedSchema: ServiceSchema = {
      generatedAt: Date.now(),
      commands: [
        {
          name: "get-old-api",
          description: "Old endpoint",
          method: "GET",
          path: "/api/old",
          contentType: "application/json",
          binaryFields: [],
          parameters: [],
          deprecated: true,
        },
      ],
    };
    buildCommands(group, deprecatedSchema, mockServiceConfig);

    const cmd = group.commands.find((c) => c.name() === "get-old-api")!;
    expect(cmd.description()).toBe("[DEPRECATED] Old endpoint");

    let helpOutput = "";
    cmd.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      },
    });
    cmd.outputHelp();
    expect(helpOutput).toContain("⚠ This API is deprecated");
  });

  it("shows default values in help text", () => {
    const group = new Command("test");
    const defaultSchema: ServiceSchema = {
      generatedAt: Date.now(),
      commands: [
        {
          name: "get-items",
          description: "List items",
          method: "GET",
          path: "/api/items",
          contentType: "application/json",
          binaryFields: [],
          parameters: [{ name: "page", in: "query", type: "integer", required: false, default: 1 }],
          bodySchema: {
            required: [],
            properties: {
              limit: { type: "integer", description: "Page size", default: 20 },
            },
          },
        },
      ],
    };
    buildCommands(group, defaultSchema, mockServiceConfig);

    const cmd = group.commands.find((c) => c.name() === "get-items")!;
    let helpOutput = "";
    cmd.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      },
    });
    cmd.outputHelp();
    expect(helpOutput).toContain("default: 1");
    expect(helpOutput).toContain("default: 20");
  });

  it("shows Content-Type in help for non-JSON endpoints", () => {
    const group = new Command("test");
    const formSchema: ServiceSchema = {
      generatedAt: Date.now(),
      commands: [
        {
          name: "post-login",
          description: "Login",
          method: "POST",
          path: "/api/login",
          contentType: "application/x-www-form-urlencoded",
          binaryFields: [],
          parameters: [],
          bodySchema: {
            required: ["username"],
            properties: {
              username: { type: "string", description: "User name" },
              password: { type: "string", description: "Password" },
            },
          },
        },
      ],
    };
    buildCommands(group, formSchema, mockServiceConfig);

    const cmd = group.commands.find((c) => c.name() === "post-login")!;
    let helpOutput = "";
    cmd.configureOutput({
      writeOut: (str) => {
        helpOutput += str;
      },
    });
    cmd.outputHelp();
    expect(helpOutput).toContain("Content-Type: application/x-www-form-urlencoded");
  });

  it("registers --raw-body option on subcommands", () => {
    const group = new Command("test");
    buildCommands(group, testSchema, mockServiceConfig);

    const cmd = group.commands[0];
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--raw-body");
  });
});
