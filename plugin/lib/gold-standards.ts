import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs"
import { randomUUID } from "crypto"
import { basename, dirname, join } from "path"

export interface GoldStandardInput {
  skillName: string
  description: string
  passRate: number
  notes?: string
}

export interface GoldStandard extends GoldStandardInput {
  id: string
  createdAt: string
}

function readStore(path: string): GoldStandard[] {
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as GoldStandard[]
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to read gold standards store at ${path}: malformed JSON`,
      )
    }
    throw error
  }
}

function sortStandards(standards: GoldStandard[]): GoldStandard[] {
  return [...standards].sort((a, b) => b.passRate - a.passRate)
}

function writeStore(path: string, standards: GoldStandard[]): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(tmpPath, JSON.stringify(sortStandards(standards).slice(0, 50), null, 2))
  renameSync(tmpPath, path)
}

export function listGoldStandards(path: string): GoldStandard[] {
  return sortStandards(readStore(path))
}

export function addGoldStandard(
  path: string,
  input: GoldStandardInput,
): GoldStandard {
  if (!Number.isFinite(input.passRate) || input.passRate < 0 || input.passRate > 1) {
    throw new Error("passRate must be a finite number between 0 and 1")
  }

  const standard: GoldStandard = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }

  writeStore(path, [...readStore(path), standard])
  return standard
}

export function removeGoldStandard(path: string, id: string): boolean {
  const standards = readStore(path)
  const remaining = standards.filter((standard) => standard.id !== id)
  if (remaining.length === standards.length) return false

  writeStore(path, remaining)
  return true
}

export function getGoldAdvice(path: string): string {
  const standards = listGoldStandards(path).slice(0, 5)
  if (standards.length === 0) return ""

  const examples = standards.map((standard) => {
    const percent = Math.round(standard.passRate * 100)
    const notes = standard.notes ? ` Notes: ${standard.notes}` : ""
    return `- ${standard.skillName} (${percent}%): ${standard.description}${notes}`
  })

  return ["GOLD STANDARD EXAMPLES:", ...examples].join("\n")
}
