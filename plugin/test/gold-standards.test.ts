import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import { expect, test } from "bun:test"

import {
  addGoldStandard,
  getGoldAdvice,
  listGoldStandards,
  removeGoldStandard,
} from "../lib/gold-standards"

const withStore = <T>(fn: (storePath: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "skill-creator-gold-"))
  try {
    return fn(join(dir, "nested", "gold-standards.json"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("addGoldStandard saves examples and listGoldStandards sorts by descending pass rate", () => {
  withStore((storePath) => {
    const weaker = addGoldStandard(storePath, {
      skillName: "cleanup-skill",
      description: "Use when cleaning project artifacts.",
      passRate: 0.8,
      notes: "Good but too broad.",
    })
    const stronger = addGoldStandard(storePath, {
      skillName: "skill-creator",
      description: "Use when creating or improving OpenCode skills.",
      passRate: 1,
    })

    expect(weaker.id).toBeString()
    expect(weaker.createdAt).toBeString()
    expect(listGoldStandards(storePath)).toEqual([stronger, weaker])
  })
})

test("addGoldStandard retains only the top 50 examples", () => {
  withStore((storePath) => {
    for (let i = 0; i < 55; i += 1) {
      addGoldStandard(storePath, {
        skillName: `skill-${i}`,
        description: `Description ${i}`,
        passRate: i / 100,
      })
    }

    const standards = listGoldStandards(storePath)
    expect(standards).toHaveLength(50)
    expect(standards[0].skillName).toBe("skill-54")
    expect(standards.at(-1)?.skillName).toBe("skill-5")
  })
})

test("addGoldStandard rejects non-finite and out-of-range pass rates", () => {
  withStore((storePath) => {
    for (const passRate of [Number.NaN, Infinity, -0.01, 1.01]) {
      expect(() =>
        addGoldStandard(storePath, {
          skillName: "skill-creator",
          description: "Use when creating OpenCode skills.",
          passRate,
        }),
      ).toThrow("passRate must be a finite number between 0 and 1")
    }
  })
})

test("listGoldStandards reports malformed store JSON with the store path", () => {
  withStore((storePath) => {
    mkdirSync(join(storePath, ".."), { recursive: true })
    writeFileSync(storePath, "not json")

    expect(() => listGoldStandards(storePath)).toThrow(
      `Failed to read gold standards store at ${storePath}: malformed JSON`,
    )
  })
})

test("getGoldAdvice returns a heading and up to five examples with skill names and descriptions", () => {
  withStore((storePath) => {
    for (let i = 0; i < 6; i += 1) {
      addGoldStandard(storePath, {
        skillName: `skill-${i}`,
        description: `Use when handling case ${i}.`,
        passRate: 1 - i / 10,
        notes: i === 0 ? "Strong positive example." : undefined,
      })
    }

    const advice = getGoldAdvice(storePath)

    expect(advice).toContain("GOLD STANDARD EXAMPLES:")
    expect(advice).toContain(
      "- skill-0 (100%): Use when handling case 0. Notes: Strong positive example.",
    )
    expect(advice).toContain("- skill-4 (60%): Use when handling case 4.")
    expect(advice).not.toContain("skill-5")
  })
})

test("getGoldAdvice returns empty string when no standards exist", () => {
  withStore((storePath) => {
    expect(getGoldAdvice(storePath)).toBe("")
  })
})

test("removeGoldStandard removes examples by id", () => {
  withStore((storePath) => {
    const standard = addGoldStandard(storePath, {
      skillName: "skill-creator",
      description: "Use when creating OpenCode skills.",
      passRate: 1,
    })

    expect(removeGoldStandard(storePath, standard.id)).toBe(true)
    expect(removeGoldStandard(storePath, standard.id)).toBe(false)
    expect(listGoldStandards(storePath)).toEqual([])
  })
})
