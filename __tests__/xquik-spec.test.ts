import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "../src/spec-parser.js";

describe("Xquik OpenAPI fixture", () => {
  it("parses account, search, compose, and webhook commands", () => {
    const fixturePath = join(process.cwd(), "__tests__", "fixtures", "xquik-spec.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

    const schema = parseSpec(fixture);
    const commands = schema.commands.map((command) => command.name);

    expect(commands).toEqual([
      "get-api-v1-account",
      "get-api-v1-x-tweets-search",
      "post-api-v1-x-tweets",
      "post-api-v1-webhooks",
    ]);
  });

  it("keeps Xquik request parameters and body schemas", () => {
    const fixturePath = join(process.cwd(), "__tests__", "fixtures", "xquik-spec.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

    const schema = parseSpec(fixture);
    const searchCommand = schema.commands.find(
      (command) => command.name === "get-api-v1-x-tweets-search",
    );
    const composeCommand = schema.commands.find(
      (command) => command.name === "post-api-v1-x-tweets",
    );

    expect(searchCommand?.parameters).toMatchObject([
      { name: "query", in: "query", required: true, type: "string" },
      { name: "limit", in: "query", required: false, type: "integer" },
    ]);
    expect(composeCommand?.bodySchema?.required).toEqual(["text"]);
    expect(composeCommand?.bodySchema?.properties.text).toMatchObject({
      type: "string",
      description: "Post text.",
    });
  });
});
