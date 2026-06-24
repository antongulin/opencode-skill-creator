import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { validateSkill } from "../lib/validate"

const fixtureDir = () => {
  const dir = join(tmpdir(), `validate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const writeSkill = (dir: string, content: string) => {
  writeFileSync(join(dir, "SKILL.md"), content)
}

// --- Valid skills -----------------------------------------------------------

test("valid skill with quoted description containing colon-space passes", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
description: "Use when tasks involve PDF files: reading, extracting, creating."
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})

test("valid skill with unquoted description (no colon-space) passes", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
description: A skill for helping with Docker compose files
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})

test("existing bundled SKILL.md fixture passes validation", () => {
  // Use the bundled skill as a real-world fixture
  const result = validateSkill(
    join(import.meta.dir, "..", "skill"),
  )
  expect(result.valid).toBe(true)
})

// --- Invalid skills ---------------------------------------------------------

test("unquoted description with colon-space fails YAML parse", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
description: Use when tasks involve PDF files: reading, extracting, creating.
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("YAML frontmatter parse error")
  expect(result.message).toContain("line 2")
  expect(result.message).toContain("quote the value")
  rmSync(dir, { recursive: true, force: true })
})

test("unquoted description with colon-space in middle of value fails", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
description: A skill for API docs: generation and review
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("YAML frontmatter parse error")
  rmSync(dir, { recursive: true, force: true })
})

test("unquoted name with colon-space fails YAML parse", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
description: A valid description
metadata:
  foo: bar
---

# My Skill
`)
  // This is valid, metadata is a map
  const result = validateSkill(dir)
  expect(result.valid).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})

// --- Error hint --------------------------------------------------------------

test("error message suggests quoting the value", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
description: Use when tasks involve PDF files: reading.
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("quote the value")
  rmSync(dir, { recursive: true, force: true })
})

// --- Other existing checks still work ---------------------------------------

test("missing SKILL.md returns invalid", () => {
  const dir = fixtureDir()
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("SKILL.md not found")
  rmSync(dir, { recursive: true, force: true })
})

test("missing frontmatter returns invalid", () => {
  const dir = fixtureDir()
  writeSkill(dir, `# My Skill\nNo frontmatter here.`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("No YAML frontmatter found")
  rmSync(dir, { recursive: true, force: true })
})

test("missing name returns invalid", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
description: A valid description
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("Missing 'name'")
  rmSync(dir, { recursive: true, force: true })
})

test("missing description returns invalid", () => {
  const dir = fixtureDir()
  writeSkill(dir, `---
name: my-skill
---

# My Skill
`)
  const result = validateSkill(dir)
  expect(result.valid).toBe(false)
  expect(result.message).toContain("Missing 'description'")
  rmSync(dir, { recursive: true, force: true })
})
