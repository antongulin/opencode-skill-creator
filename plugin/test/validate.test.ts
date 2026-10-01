import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { expect, test } from "bun:test"

import { validateSkill } from "../lib/validate"

const withSkill = <T>(frontmatter: string, fn: (skillPath: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "skill-creator-validate-"))
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Test Skill\n`)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Windows checkouts (core.autocrlf=true) write EVERY line ending — the
// frontmatter delimiters included — as CRLF. Build the whole document that way
// so the fixture has no bare LF that would make the test pass by accident.
const withCrlfSkill = <T>(frontmatter: string, fn: (skillPath: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "skill-creator-validate-"))
  try {
    mkdirSync(dir, { recursive: true })
    const contents = `---\n${frontmatter}\n---\n\n# Test Skill\n`.split("\n").join("\r\n")
    // Fixture sanity: no bare LF and no lone CR remain (a full CRLF document).
    const stripped = contents.replace(/\r\n/g, "")
    expect(stripped.includes("\n")).toBe(false)
    expect(stripped.includes("\r")).toBe(false)
    writeFileSync(join(dir, "SKILL.md"), contents)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("quoted description containing colon-space passes", () => {
  withSkill(
    `name: pdf-reader
description: "Use for PDF files: reading, extracting."`,
    (skillPath) => {
      expect(validateSkill(skillPath)).toEqual({
        valid: true,
        message: "Skill is valid!",
      })
    },
  )
})

test("unquoted description without colon-space passes", () => {
  withSkill(
    `name: pdf-reader
description: Use for PDF files, reading and extracting.`,
    (skillPath) => {
      expect(validateSkill(skillPath)).toEqual({
        valid: true,
        message: "Skill is valid!",
      })
    },
  )
})

test("bundled skill fixture passes validation", () => {
  expect(validateSkill(join(import.meta.dir, "..", "skill"))).toEqual({
    valid: true,
    message: "Skill is valid!",
  })
})

test("unquoted description with colon-space fails with quote hint", () => {
  withSkill(
    `name: pdf-reader
description: Use for PDF files: reading, extracting.`,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("description")
      expect(result.message).toContain("line 3")
      expect(result.message).toContain("Hint: quote the value")
      expect(result.message).toContain("description: \"your text here\"")
      expect(result.message).toContain(
        "unquoted values containing ': ' or ending with ':' are invalid YAML",
      )
      expect(result.message).toContain("runtime will drop this skill")
    },
  )
})

test("single-quoted description containing colon-space passes", () => {
  withSkill(
    `name: pdf-reader
description: 'Use for PDF files: reading, extracting.'`,
    (skillPath) => {
      expect(validateSkill(skillPath)).toEqual({
        valid: true,
        message: "Skill is valid!",
      })
    },
  )
})

test("block scalar content with colon-space passes", () => {
  withSkill(
    `name: pdf-reader
description: |2-
  Use for PDF files: reading, extracting.`,
    (skillPath) => {
      expect(validateSkill(skillPath)).toEqual({
        valid: true,
        message: "Skill is valid!",
      })
    },
  )
})

test("unquoted value with colon-space mid-value fails", () => {
  withSkill(
    `name: pdf-reader
description: Use when reading docs.
compatibility: Works with docs: markdown and PDF`,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("compatibility")
      expect(result.message).toContain("line 4")
    },
  )
})

test("unquoted value ending with colon fails", () => {
  withSkill(
    `name: pdf-reader
description: Note:`,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("description")
      expect(result.message).toContain("line 3")
      expect(result.message).toContain("Hint: quote the value")
    },
  )
})

test("unquoted value with trailing colon-space fails after trim (ends-with-colon path)", () => {
  withSkill(
    `name: pdf-reader
description: Note: `,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("description")
      expect(result.message).toContain("line 3")
      expect(result.message).toContain("Hint: quote the value")
    },
  )
})

test("unquoted value with colon-tab fails", () => {
  withSkill(
    `name: pdf-reader
description: Use for PDF files:\treading`,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("description")
      expect(result.message).toContain("line 3")
    },
  )
})

test("unquoted name with colon-space fails before name validation", () => {
  withSkill(
    `name: pdf: reader
description: Use when reading docs.`,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("name")
      expect(result.message).toContain("line 2")
      expect(result.message).toContain("Hint: quote the value")
    },
  )
})

test("CRLF frontmatter passes validation", () => {
  withCrlfSkill(
    `name: pdf-reader
description: "Use for PDF files: reading, extracting."`,
    (skillPath) => {
      expect(validateSkill(skillPath)).toEqual({
        valid: true,
        message: "Skill is valid!",
      })
    },
  )
})

test("CRLF block scalar description passes validation", () => {
  withCrlfSkill(
    `name: pdf-reader
description: |2-
  Use for PDF files: reading, extracting.`,
    (skillPath) => {
      expect(validateSkill(skillPath)).toEqual({
        valid: true,
        message: "Skill is valid!",
      })
    },
  )
})

test("CRLF unquoted colon-space still fails with correct line number", () => {
  withCrlfSkill(
    `name: pdf-reader
description: Use for PDF files: reading, extracting.`,
    (skillPath) => {
      const result = validateSkill(skillPath)

      expect(result.valid).toBe(false)
      expect(result.message).toContain("description")
      expect(result.message).toContain("line 3")
      expect(result.message).toContain("Hint: quote the value")
    },
  )
})
