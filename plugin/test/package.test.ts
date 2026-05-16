import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("package metadata exposes compiled plugin entrypoint", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"))

  expect(pkg.main).toBe("./dist/skill-creator.js")
})
