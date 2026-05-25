import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

const publishWorkflowPath = fileURLToPath(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
)

function extractTrustedPublishingVersionCheck(workflow) {
  const match = workflow.match(/node -e '([^']+)' "\$NPM_VERSION"/)
  assert.ok(match, "expected npm trusted publishing version check script")
  return match[1]
}

function runVersionCheck(script, version) {
  try {
    execFileSync(process.execPath, ["-e", script, version], { stdio: "pipe" })
    return { ok: true }
  } catch (error) {
    return { ok: false, stderr: String(error.stderr) }
  }
}

test("publish workflow prepares dependencies required by prepack", () => {
  const workflow = readFileSync(publishWorkflowPath, "utf-8")

  assert.match(workflow, /oven-sh\/setup-bun@v\d+/)
  assert.match(workflow, /working-directory:\s*plugin\s+run:\s*npm install/s)
  assert.match(workflow, /run:\s*npm publish --access public --provenance\s+working-directory:\s*plugin/s)
})

test("publish workflow uses npm trusted publishing provenance", () => {
  const workflow = readFileSync(publishWorkflowPath, "utf-8")

  assert.match(workflow, /permissions:\s+contents:\s*write\s+id-token:\s*write/s)
  assert.match(workflow, /run:\s*npm install -g npm@latest/)
  assert.match(workflow, /NPM_VERSION=\$\(npm --version\)/)
  assert.match(workflow, /too old for trusted publishing/)
  assert.match(workflow, /trusted publishing is bound to this repository\/workflow/)
  assert.match(workflow, /forks and non-main refs cannot publish/)
  assert.match(
    workflow,
    /if:\s*steps\.npm\.outputs\.exists != 'true' && github\.repository == 'antongulin\/opencode-skill-creator' && github\.ref == 'refs\/heads\/main'\s+run:\s*npm publish --access public --provenance/s,
  )
  assert.match(workflow, /run:\s*npm publish --access public --provenance\s+working-directory:\s*plugin/s)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/)
})

test("publish workflow rejects incomplete npm versions for trusted publishing", () => {
  const workflow = readFileSync(publishWorkflowPath, "utf-8")
  const script = extractTrustedPublishingVersionCheck(workflow)

  assert.equal(runVersionCheck(script, "11").ok, false)
  assert.equal(runVersionCheck(script, "11.5").ok, false)
  assert.equal(runVersionCheck(script, "11.5.0").ok, false)
  assert.equal(runVersionCheck(script, "11.5.1").ok, true)
  assert.equal(runVersionCheck(script, "12.0.0").ok, true)
})
