/**
 * Skill validation — validates SKILL.md frontmatter and structure.
 *
 * Mirrors scripts/quick_validate.py. Uses hand-parsed YAML (no PyYAML
 * equivalent needed — we parse frontmatter manually like utils.ts).
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"

export interface ValidationResult {
  valid: boolean
  message: string
}

/** Allowed top-level frontmatter keys. */
const ALLOWED_PROPERTIES = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
])

/**
 * Validate a skill directory.
 *
 * Checks that SKILL.md exists, has well-formed YAML frontmatter with required
 * fields, enforces naming conventions, description limits, etc.
 */
export function validateSkill(skillPath: string): ValidationResult {
  const skillMdPath = join(skillPath, "SKILL.md")

  // Check SKILL.md exists
  if (!existsSync(skillMdPath)) {
    return { valid: false, message: "SKILL.md not found" }
  }

  const content = readFileSync(skillMdPath, "utf-8")
  if (!content.startsWith("---")) {
    return { valid: false, message: "No YAML frontmatter found" }
  }

  // Extract frontmatter text
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    return { valid: false, message: "Invalid frontmatter format" }
  }

  const frontmatterText = match[1]

  // Parse frontmatter into key-value pairs (simple line-based parsing)
  const frontmatter: Record<string, string> = {}
  let currentKey = ""
  let currentValue = ""
  let inMultiline = false

  for (const line of frontmatterText.split("\n")) {
    if (inMultiline) {
      if (line.startsWith("  ") || line.startsWith("\t")) {
        currentValue += " " + line.trim()
        continue
      } else {
        frontmatter[currentKey] = currentValue.trim()
        inMultiline = false
      }
    }

    const kvMatch = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1]
      const value = kvMatch[2].trim()

      if ([">", "|", ">-", "|-"].includes(value)) {
        currentValue = ""
        inMultiline = true
      } else if (
        currentKey === "metadata" &&
        (value === "" || value === "{}")
      ) {
        // metadata is a map — accept it as present
        frontmatter[currentKey] = value
      } else {
        frontmatter[currentKey] = value.replace(/^['"]|['"]$/g, "")
      }
    } else if (line.match(/^\s+\w+\s*:/)) {
      // Nested key under metadata — skip but ensure parent key is present
      if (!frontmatter["metadata"]) {
        frontmatter["metadata"] = "(map)"
      }
    }
  }

  if (inMultiline && currentKey) {
    frontmatter[currentKey] = currentValue.trim()
  }

  // Check for unexpected properties
  const unexpectedKeys = Object.keys(frontmatter).filter(
    (k) => !ALLOWED_PROPERTIES.has(k)
  )
  if (unexpectedKeys.length > 0) {
    return {
      valid: false,
      message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(", ")}. Allowed properties are: ${[...ALLOWED_PROPERTIES].sort().join(", ")}`,
    }
  }

  // Check required fields
  if (!frontmatter["name"]) {
    return { valid: false, message: "Missing 'name' in frontmatter" }
  }
  if (!frontmatter["description"]) {
    return { valid: false, message: "Missing 'description' in frontmatter" }
  }

  // Validate name
  const name = frontmatter["name"].trim()
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        valid: false,
        message: `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only)`,
      }
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      return {
        valid: false,
        message: `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`,
      }
    }
    if (name.length > 64) {
      return {
        valid: false,
        message: `Name is too long (${name.length} characters). Maximum is 64 characters.`,
      }
    }
  }

  // Validate description
  const description = frontmatter["description"].trim()
  if (description) {
    if (description.includes("<") || description.includes(">")) {
      return {
        valid: false,
        message: "Description cannot contain angle brackets (< or >)",
      }
    }
    if (description.length > 1024) {
      return {
        valid: false,
        message: `Description is too long (${description.length} characters). Maximum is 1024 characters.`,
      }
    }
  }

  // Validate compatibility (optional)
  const compatibility = frontmatter["compatibility"]
  if (compatibility) {
    if (compatibility.length > 500) {
      return {
        valid: false,
        message: `Compatibility is too long (${compatibility.length} characters). Maximum is 500 characters.`,
      }
    }
  }

  return { valid: true, message: "Skill is valid!" }
}
