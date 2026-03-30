import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("repo hygiene", () => {
  it("does not include a bundled photo.jpg fixture in the repo root", () => {
    expect(existsSync(resolve(repoRoot, "photo.jpg"))).toBe(false);
  });
});
