import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

const publishWorkflowPath = fileURLToPath(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
)

test("publish workflow prepares dependencies required by prepack", () => {
  const workflow = readFileSync(publishWorkflowPath, "utf-8")

  assert.match(workflow, /oven-sh\/setup-bun@v\d+/)
  assert.match(workflow, /working-directory:\s*plugin\s+run:\s*npm install/s)
  assert.match(workflow, /run:\s*npm publish --access public\s+working-directory:\s*plugin/s)
})
