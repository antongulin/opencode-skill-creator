/**
 * Workflow guard helpers for eval review launch.
 *
 * Enforces paired with-skill/baseline run structure before opening the review
 * viewer, unless explicitly overridden.
 */

import { existsSync, readdirSync, statSync } from "fs"
import { basename, join } from "path"

function sortedDirs(dir: string, pattern?: RegExp): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((full) => statSync(full).isDirectory())
    .filter((full) => (pattern ? pattern.test(basename(full)) : true))
    .sort()
}

function hasAtLeastOneRun(configDir: string): boolean {
  const runDirs = sortedDirs(configDir, /^run-/)
  if (runDirs.length > 0) return true

  // Common task-output layout when run-N folders were not created.
  const outputsDir = join(configDir, "outputs")
  return existsSync(outputsDir) && statSync(outputsDir).isDirectory()
}

export interface WorkflowValidationIssue {
  evalDir: string
  issue: string
}

export interface WorkflowValidationResult {
  valid: boolean
  evalCount: number
  issues: WorkflowValidationIssue[]
  foundConfigs: string[]
  searchRoot: string
}

export function validateComparisonWorkspace(
  workspace: string,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = []
  const foundConfigs = new Set<string>()

  if (!existsSync(workspace)) {
    return {
      valid: false,
      evalCount: 0,
      issues: [
        {
          evalDir: basename(workspace),
          issue: "workspace path does not exist",
        },
      ],
      foundConfigs: [],
      searchRoot: workspace,
    }
  }

  if (!statSync(workspace).isDirectory()) {
    return {
      valid: false,
      evalCount: 0,
      issues: [
        {
          evalDir: basename(workspace),
          issue: "workspace path is not a directory",
        },
      ],
      foundConfigs: [],
      searchRoot: workspace,
    }
  }

  let searchRoot = workspace
  let evalDirs = sortedDirs(searchRoot, /^eval-/)
  if (evalDirs.length === 0) {
    const runsRoot = join(workspace, "runs")
    const nested = sortedDirs(runsRoot, /^eval-/)
    if (nested.length > 0) {
      searchRoot = runsRoot
      evalDirs = nested
    }
  }

  if (evalDirs.length === 0) {
    issues.push({
      evalDir: basename(workspace),
      issue: "no eval-* directories found (expected evals with with_skill and baseline runs)",
    })
  }

  for (const evalDir of evalDirs) {
    const withSkillDir = join(evalDir, "with_skill")
    const withoutSkillDir = join(evalDir, "without_skill")
    const oldSkillDir = join(evalDir, "old_skill")

    if (existsSync(withSkillDir) && statSync(withSkillDir).isDirectory()) {
      foundConfigs.add("with_skill")
    }
    if (existsSync(withoutSkillDir) && statSync(withoutSkillDir).isDirectory()) {
      foundConfigs.add("without_skill")
    }
    if (existsSync(oldSkillDir) && statSync(oldSkillDir).isDirectory()) {
      foundConfigs.add("old_skill")
    }

    const hasWithSkill =
      existsSync(withSkillDir) &&
      statSync(withSkillDir).isDirectory() &&
      hasAtLeastOneRun(withSkillDir)

    const hasWithoutSkill =
      existsSync(withoutSkillDir) &&
      statSync(withoutSkillDir).isDirectory() &&
      hasAtLeastOneRun(withoutSkillDir)

    const hasOldSkill =
      existsSync(oldSkillDir) &&
      statSync(oldSkillDir).isDirectory() &&
      hasAtLeastOneRun(oldSkillDir)

    if (!hasWithSkill) {
      issues.push({
        evalDir: basename(evalDir),
        issue: "missing with_skill run outputs",
      })
    }

    if (!hasWithoutSkill && !hasOldSkill) {
      issues.push({
        evalDir: basename(evalDir),
        issue: "missing baseline run outputs (without_skill or old_skill)",
      })
    }
  }

  return {
    valid: issues.length === 0,
    evalCount: evalDirs.length,
    issues,
    foundConfigs: [...foundConfigs].sort(),
    searchRoot,
  }
}
