/**
 * Shared utilities for skill-creator plugin.
 *
 * Reads SKILL.md frontmatter without a YAML library. The reader handles a
 * bounded subset: top-level `name:` and `description:` keys, where the
 * description is either a single-line scalar or a `|`/`>` block scalar with an
 * optional chomping indicator (`+`/`-`) and an optional explicit indentation
 * digit (`1-9`), in either order. It is NOT a general YAML parser — anchors,
 * escapes, flow maps, nested maps and multi-document streams are out of scope.
 */

import { readFileSync } from "fs"
import { join } from "path"

export interface SkillMeta {
  name: string
  description: string
  fullContent: string
}

/**
 * Block-scalar header grammar, identical to `lib/validate.ts`: indicator
 * (`|` or `>`), then optional explicit indentation (`1-9`) and chomping
 * (`+`/`-`) in either order.
 */
const BLOCK_SCALAR_HEADER_RE = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/

type Chomp = "clip" | "strip" | "keep"

interface BlockScalarHeader {
  literal: boolean
  chomp: Chomp
  /** Explicit indentation digit, or null when inferred from the first line. */
  indent: number | null
}

function parseBlockScalarHeader(header: string): BlockScalarHeader {
  const literal = header.startsWith("|")
  const chomp: Chomp = header.includes("-")
    ? "strip"
    : header.includes("+")
      ? "keep"
      : "clip"
  const indentMatch = header.match(/[1-9]/)
  return { literal, chomp, indent: indentMatch ? Number(indentMatch[0]) : null }
}

interface ContentLine {
  /** Line content with the block indentation removed (more-indented kept). */
  text: string
  blank: boolean
  /** True when the source line is indented deeper than the block indent. */
  moreIndented: boolean
}

/**
 * Strip a single trailing carriage return so CRLF input yields LF scalar
 * values. `fullContent` is never touched, so the file bytes stay unchanged.
 */
function stripTrailingCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

/**
 * Fold a literal block: line breaks and interior blank lines are preserved
 * verbatim, including extra indentation and trailing spaces on each line.
 */
function joinLiteral(lines: ContentLine[]): string {
  return lines.map((line) => line.text).join("\n")
}

/**
 * Fold a `>` block: adjacent ordinary lines join with a single space; a blank
 * line becomes a newline; a more-indented line is kept verbatim and the breaks
 * around it stay newlines (matching the YAML reference for this bounded
 * subset). Chomping is applied by the caller after trailing blanks are cut.
 */
function foldLines(lines: ContentLine[]): string {
  let out = ""
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (index === 0) {
      out += line.blank ? "\n" : line.text
      continue
    }
    const previous = lines[index - 1]
    if (line.blank) {
      out += "\n"
    } else if (previous.blank) {
      // The blank already emitted a newline; a more-indented line keeps its own
      // preceding break as well, an ordinary line does not.
      out += (line.moreIndented ? "\n" : "") + line.text
    } else if (previous.moreIndented || line.moreIndented) {
      out += "\n" + line.text
    } else {
      out += " " + line.text
    }
  }
  return out
}

/**
 * Read a bounded YAML block scalar body starting at `startIndex`, returning the
 * scalar value and the index of the first line after the block. The block ends
 * at the first non-blank line indented less than the block indent; a leading
 * non-blank line at column 0 with no explicit indent means an empty block.
 */
function parseBlockScalar(
  header: string,
  lines: string[],
  startIndex: number,
): { value: string; next: number } {
  const { literal, chomp, indent } = parseBlockScalarHeader(header)

  const body: ContentLine[] = []
  let blockIndent = indent
  let index = startIndex
  while (index < lines.length) {
    const raw = stripTrailingCr(lines[index])
    if (raw.trim() === "") {
      body.push({ text: "", blank: true, moreIndented: false })
      index++
      continue
    }
    const lineIndent = raw.length - raw.trimStart().length
    if (blockIndent === null) {
      if (lineIndent === 0) break
      blockIndent = lineIndent
    }
    if (lineIndent < blockIndent) break
    body.push({
      text: raw.slice(blockIndent),
      blank: false,
      moreIndented: lineIndent > blockIndent,
    })
    index++
  }

  // Trailing blank lines are chomped, not folded, so cut them before joining.
  let end = body.length
  while (end > 0 && body[end - 1].blank) end--
  const trailingBlanks = body.length - end
  const content = body.slice(0, end)

  const joined = literal ? joinLiteral(content) : foldLines(content)
  let suffix = ""
  if (chomp === "keep") {
    // Keep preserves the block's trailing breaks: the final content line's own
    // break (present only when there is content) plus one break per trailing
    // blank line. A blank-only keep block keeps exactly its blank lines.
    const breaks = (content.length > 0 ? 1 : 0) + trailingBlanks
    suffix = "\n".repeat(breaks)
  } else if (chomp === "clip" && content.length > 0) {
    // Clip keeps a single final break for a non-empty block; a blank-only clip
    // block is empty.
    suffix = "\n"
  }
  // "strip" (and blank-only "clip") keep the empty suffix.

  return { value: joined + suffix, next: index }
}

/**
 * Parse a SKILL.md file and return its name, description, and full content.
 *
 * `description` may be a single-line scalar or a `|`/`>` block scalar (bounded
 * header grammar above) whose chomping, blank lines and more-indented lines
 * follow the YAML reference for this subset.
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

      if (BLOCK_SCALAR_HEADER_RE.test(value)) {
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
