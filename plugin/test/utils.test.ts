import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { expect, test } from "bun:test"

import { parseSkillMd } from "../lib/utils"

const withSkillMd = <T>(frontmatter: string, fn: (skillPath: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "skill-creator-utils-"))
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Test Skill\n`)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("literal block scalar keeps line breaks and blank lines", () => {
  withSkillMd(
    `name: pdf-reader
description: |
  First line.

  Second line`,
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("First line.\n\nSecond line")
    },
  )
})

test("literal block scalar does not terminate at a blank line before the next key", () => {
  withSkillMd(
    `name: pdf-reader
description: |
  First line.

  Second line
license: Apache-2.0`,
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("First line.\n\nSecond line")
      expect(parseSkillMd(skillPath).name).toBe("pdf-reader")
    },
  )
})

test("folded block scalar folds lines but keeps blank lines as newlines", () => {
  withSkillMd(
    `name: pdf-reader
description: >
  folded one
  folded two

  third line`,
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe(
        "folded one folded two\nthird line",
      )
    },
  )
})

test("block scalar with explicit indentation indicator is parsed, not taken as the value", () => {
  withSkillMd(
    `name: pdf-reader
description: |2-
  Indented content line one
  Indented content line two`,
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe(
        "Indented content line one\nIndented content line two",
      )
    },
  )
})

test("single-line description keeps stripping quotes", () => {
  withSkillMd(
    `name: pdf-reader
description: "Use for PDF files: reading, extracting."`,
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe(
        "Use for PDF files: reading, extracting.",
      )
    },
  )
})
