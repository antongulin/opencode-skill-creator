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

/**
 * Parse a SKILL.md file and return its name, description, and full content.
 *
 * Handles YAML multiline scalar indicators (>, |, >-, |-).
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

      // Handle YAML multiline indicators (>, |, >-, |-)
      if ([">", "|", ">-", "|-"].includes(value)) {
        const continuationLines: string[] = []
        i++
        while (
          i < frontmatterLines.length &&
          (frontmatterLines[i].startsWith("  ") ||
            frontmatterLines[i].startsWith("\t"))
        ) {
          continuationLines.push(frontmatterLines[i].trim())
          i++
        }
        description = continuationLines.join(" ")
        continue
      } else {
        description = value.replace(/^['"]|['"]$/g, "")
      }
    }
    i++
  }

  return { name, description, fullContent: content }
}
