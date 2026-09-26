/**
 * Shared utilities for skill-creator plugin.
 *
 * Mirrors scripts/utils.py — parses SKILL.md frontmatter without a YAML library.
 */

import { readFileSync } from "fs"
import { join } from "path"

export interface SkillMeta {
  name: string
  description: string
  fullContent: string
}

// Same block-scalar header grammar as lib/validate.ts: indicator (| or >),
// optional chomping (+/-) and explicit indentation (1-9) in either order.
const BLOCK_SCALAR_MARKER_RE = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/

/**
 * Parse a YAML block scalar body starting at `startIndex`.
 *
 * Hand-rolled (zero dependencies) but faithful where the naive version was
 * not: blank lines inside the body do not end the block, `|` literal blocks
 * keep their line breaks, and `>` folded blocks only fold non-blank lines.
 */
function parseBlockScalar(
  header: string,
  lines: string[],
  startIndex: number,
): { value: string; next: number } {
  const literal = header.startsWith("|")
  const explicitIndent = header.match(/[1-9]/)
  let blockIndent = explicitIndent ? Number(explicitIndent[0]) : -1

  const body: string[] = []
  let i = startIndex
  while (i < lines.length) {
    const raw = lines[i]
    if (raw.trim() === "") {
      // Blank line: part of the block (a non-indented line ends it).
      body.push("")
      i++
      continue
    }
    const indent = raw.length - raw.trimStart().length
    if (indent === 0) break
    if (blockIndent === -1) blockIndent = indent
    if (indent < blockIndent) break
    body.push(raw.slice(blockIndent).replace(/\s+$/, ""))
    i++
  }

  // Default "clip" chomping: trailing blank lines do not end up in the value.
  while (body.length > 0 && body[body.length - 1] === "") body.pop()

  if (literal) {
    return { value: body.join("\n"), next: i }
  }

  let folded = ""
  for (const line of body) {
    if (line === "") {
      folded += "\n"
    } else if (folded === "" || folded.endsWith("\n")) {
      folded += line
    } else {
      folded += " " + line
    }
  }
  return { value: folded, next: i }
}

/**
 * Parse a SKILL.md file and return its name, description, and full content.
 *
 * Handles YAML multiline scalar indicators (>, |, >-, |-, plus explicit
 * indentation) with blank lines and literal/folded newline fidelity.
 */
export function parseSkillMd(skillPath: string): SkillMeta {
  const content = readFileSync(join(skillPath, "SKILL.md"), "utf-8")
  const lines = content.split("\n")

  if (lines[0].trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)")
  }

  let endIdx: number | null = null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i
      break
    }
  }

  if (endIdx === null) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)")
  }

  let name = ""
  let description = ""
  const frontmatterLines = lines.slice(1, endIdx)
  let i = 0

  while (i < frontmatterLines.length) {
    const line = frontmatterLines[i]

    if (line.startsWith("name:")) {
      name = line.slice("name:".length).trim().replace(/^['"]|['"]$/g, "")
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim()

      // Handle YAML multiline indicators (>, |, >-, |-, |2, ...)
      if (BLOCK_SCALAR_MARKER_RE.test(value)) {
        const parsed = parseBlockScalar(value, frontmatterLines, i + 1)
        description = parsed.value
        i = parsed.next
        continue
      } else {
        description = value.replace(/^['"]|['"]$/g, "")
      }
    }
    i++
  }

  return { name, description, fullContent: content }
}
