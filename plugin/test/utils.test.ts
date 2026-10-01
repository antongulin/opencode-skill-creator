import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { expect, test } from "bun:test"

import { parseSkillMd } from "../lib/utils"

/**
 * Write a SKILL.md from an explicit line array so the file bytes on disk are
 * exactly what the expected values below assume (no hidden trailing newline).
 */
function withSkillLines<T>(lines: string[], fn: (skillPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "skill-creator-utils-"))
  try {
    writeFileSync(join(dir, "SKILL.md"), `${lines.join("\n")}\n`)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const CLOSE = ["---", ""]

// Expected values are pinned from the already-installed `yaml@2.9.1` reference
// (read-only), NOT from a previous implementation.

test("literal block scalar keeps line breaks and blank lines", () => {
  withSkillLines(
    [
      "---",
      "name: pdf-reader",
      "description: |",
      "  First line.",
      "",
      "  Second line",
      "license: MIT",
      ...CLOSE,
    ],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("First line.\n\nSecond line\n")
      expect(parseSkillMd(skillPath).name).toBe("pdf-reader")
    },
  )
})

test("folded block scalar folds adjacent lines and keeps a blank line as a break", () => {
  withSkillLines(
    [
      "---",
      "name: pdf-reader",
      "description: >",
      "  folded one",
      "  folded two",
      "",
      "  third line",
      ...CLOSE,
    ],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe(
        "folded one folded two\nthird line\n",
      )
    },
  )
})

test("explicit indentation indicator parses in either order (|2-, |-2)", () => {
  withSkillLines(
    ["---", "name: s", "description: |2-", "  Indented one", "  Indented two", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("Indented one\nIndented two")
    },
  )
  withSkillLines(
    ["---", "name: s", "description: |-2", "  Indented one", "  Indented two", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("Indented one\nIndented two")
    },
  )
})

test("explicit indentation with fold chomp parses in either order (>2+, >+2)", () => {
  withSkillLines(["---", "name: s", "description: >2+", "  a", "  b", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("a b\n")
  })
  withSkillLines(
    ["---", "name: s", "description: >+2", "  a", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a b\n")
    },
  )
})

test("literal clip keeps exactly one trailing newline; explicit |2 clip does too", () => {
  withSkillLines(["---", "name: s", "description: |", "  a", "  b", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("a\nb\n")
  })
  withSkillLines(
    ["---", "name: s", "description: |2", "  a", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a\nb\n")
    },
  )
})

test("strip chomping removes trailing breaks, keep preserves them", () => {
  withSkillLines(["---", "name: s", "description: |-", "  a", "  b", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("a\nb")
  })
  withSkillLines(
    ["---", "name: s", "description: >2-", "  a", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a b")
    },
  )
  // A keep block with no explicit trailing blank adds only the content break.
  withSkillLines(["---", "name: s", "description: |+", "  only", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("only\n")
  })
  // Each blank line after the content is preserved by keep: the content line's
  // own break plus one more per blank line (exact-byte oracle: only\n\n).
  withSkillLines(["---", "name: s", "description: |+", "  only", "", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("only\n\n")
  })
  withSkillLines(
    ["---", "name: s", "description: |+", "  only", "", "", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("only\n\n\n")
    },
  )
})

test("keep chomping on a blank-only block keeps exactly its blank lines", () => {
  // Exact-byte oracle: a keep block with no content but one blank line is one
  // newline; a clip/strip blank-only block is empty.
  withSkillLines(["---", "name: s", "description: |+", "", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("\n")
  })
  withSkillLines(["---", "name: s", "description: >+", "", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("\n")
  })
  withSkillLines(["---", "name: s", "description: |", "", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("")
  })
  withSkillLines(["---", "name: s", "description: |-", "", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("")
  })
})

test("strip chomping keeps interior blank lines", () => {
  withSkillLines(
    ["---", "name: s", "description: >-", "  a", "", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a\nb")
    },
  )
  withSkillLines(
    ["---", "name: s", "description: |-", "  a", "", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a\n\nb")
    },
  )
})

test("more-indented lines keep their indentation and breaks in literal and folded blocks", () => {
  withSkillLines(
    ["---", "name: s", "description: |", "  a", "    more indented", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a\n  more indented\nb\n")
    },
  )
  withSkillLines(
    ["---", "name: s", "description: >", "  a", "    more indented", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a\n  more indented\nb\n")
    },
  )
  // A folded block with a paragraph break followed by a more-indented line
  // keeps the blank break AND the more-indented line's own indentation.
  withSkillLines(
    ["---", "name: s", "description: >", "  a", "", "    indented", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a\n\n  indented\nb\n")
    },
  )
})

test("literal block preserves trailing spaces on a line", () => {
  withSkillLines(
    ["---", "name: s", "description: |", "  a  ", "  b", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("a  \nb\n")
    },
  )
})

test("multiple literal paragraphs keep both breaks and a clip trailing newline", () => {
  withSkillLines(
    ["---", "name: s", "description: |", "  p1", "", "  p2", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("p1\n\np2\n")
    },
  )
})

test("leading blank line inside a literal block is preserved", () => {
  withSkillLines(
    ["---", "name: s", "description: |", "", "  a", ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("\na\n")
    },
  )
})

test("block scalar ends at a sibling key boundary", () => {
  withSkillLines(
    ["---", "name: s", "description: |", "  a", "  b", "license: MIT", ...CLOSE],
    (skillPath) => {
      const meta = parseSkillMd(skillPath)
      expect(meta.description).toBe("a\nb\n")
      expect(meta.name).toBe("s")
    },
  )
})

test("empty block scalar yields an empty description", () => {
  withSkillLines(["---", "name: s", "description: |", "license: MIT", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("")
  })
})

test("a CRLF literal block is normalized in the value only, not in fullContent", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-creator-utils-crlf-"))
  try {
    const raw =
      "---\r\nname: s\r\ndescription: |\r\n  line a\r\n  line b\r\n---\r\n\r\n# T\r\n"
    writeFileSync(join(dir, "SKILL.md"), raw)
    const meta = parseSkillMd(dir)
    expect(meta.description).toBe("line a\nline b\n")
    // fullContent is the ORIGINAL bytes, CRLF intact.
    expect(meta.fullContent).toBe(raw)
    expect(meta.fullContent.includes("\r\n")).toBe(true)
    // Re-reading the file confirms nothing was rewritten on disk.
    expect(readFileSync(join(dir, "SKILL.md"), "utf-8")).toBe(raw)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("single-line quoted and plain descriptions are unchanged controls", () => {
  withSkillLines(
    ["---", "name: s", 'description: "Use for: x, y."', ...CLOSE],
    (skillPath) => {
      expect(parseSkillMd(skillPath).description).toBe("Use for: x, y.")
    },
  )
  withSkillLines(["---", "name: s", "description: plain text", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("plain text")
  })
})

test("a description value that is not a block scalar header is not treated as one", () => {
  // A literal `|` inside a normal scalar must not be mistaken for a header.
  withSkillLines(["---", "name: s", "description: a | b", ...CLOSE], (p) => {
    expect(parseSkillMd(p).description).toBe("a | b")
  })
})
