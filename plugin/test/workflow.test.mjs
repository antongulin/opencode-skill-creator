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
  assert.match(workflow, /run:\s*npm publish --access public --provenance\s+working-directory:\s*plugin/s)
})

test("publish workflow uses npm trusted publishing provenance", () => {
  const workflow = readFileSync(publishWorkflowPath, "utf-8")

  assert.match(workflow, /permissions:\s+contents:\s*write\s+id-token:\s*write/s)
  assert.match(workflow, /trusted publishing is bound to this repository\/workflow/)
  assert.match(workflow, /forks and non-main refs cannot publish/)
  assert.match(
    workflow,
    /if:\s*steps\.npm\.outputs\.exists != 'true' && github\.repository == 'antongulin\/opencode-skill-creator' && github\.ref == 'refs\/heads\/main'\s+run:\s*npm publish --access public --provenance/s,
  )
  assert.match(workflow, /run:\s*npm publish --access public --provenance\s+working-directory:\s*plugin/s)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/)
})
