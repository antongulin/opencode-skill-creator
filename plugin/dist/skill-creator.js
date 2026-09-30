// @bun
// skill-creator.ts
import { tool } from "@opencode-ai/plugin";
import { join as join10, dirname as dirname3, isAbsolute, relative as relative2, sep } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { existsSync as existsSync8, mkdirSync as mkdirSync6, readFileSync as readFileSync7, rmSync as rmSync3, writeFileSync as writeFileSync8 } from "fs";

// lib/validate.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
var ALLOWED_PROPERTIES = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility"
]);
function isQuotedValue(value) {
  return value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"));
}
function isBlockScalarMarker(value) {
  return /^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(value);
}
function validateSkill(skillPath) {
  const skillMdPath = join(skillPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return { valid: false, message: "SKILL.md not found" };
  }
  const content = readFileSync(skillMdPath, "utf-8");
  if (!content.startsWith("---")) {
    return { valid: false, message: "No YAML frontmatter found" };
  }
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { valid: false, message: "Invalid frontmatter format" };
  }
  const frontmatterText = match[1];
  const frontmatter = {};
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;
  const frontmatterLines = frontmatterText.split(`
`);
  for (const [index, line] of frontmatterLines.entries()) {
    if (inMultiline) {
      if (line.startsWith("  ") || line.startsWith("\t")) {
        currentValue += " " + line.trim();
        continue;
      } else {
        frontmatter[currentKey] = currentValue.trim();
        inMultiline = false;
      }
    }
    const kvMatch = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value && !isQuotedValue(value) && !isBlockScalarMarker(value) && (/:[ \t]/.test(value) || value.endsWith(":"))) {
        return {
          valid: false,
          message: `Invalid frontmatter value for '${currentKey}' on line ${index + 2}: unquoted values containing ': ' or ending with ':' are invalid YAML and the runtime will drop this skill. Hint: quote the value (e.g. ${currentKey}: "your text here").`
        };
      }
      if (isBlockScalarMarker(value)) {
        currentValue = "";
        inMultiline = true;
      } else if (currentKey === "metadata" && (value === "" || value === "{}")) {
        frontmatter[currentKey] = value;
      } else {
        frontmatter[currentKey] = value.replace(/^['"]|['"]$/g, "");
      }
    } else if (line.match(/^\s+\w+\s*:/)) {
      if (!frontmatter["metadata"]) {
        frontmatter["metadata"] = "(map)";
      }
    }
  }
  if (inMultiline && currentKey) {
    frontmatter[currentKey] = currentValue.trim();
  }
  const unexpectedKeys = Object.keys(frontmatter).filter((k) => !ALLOWED_PROPERTIES.has(k));
  if (unexpectedKeys.length > 0) {
    return {
      valid: false,
      message: `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(", ")}. Allowed properties are: ${[...ALLOWED_PROPERTIES].sort().join(", ")}`
    };
  }
  if (!frontmatter["name"]) {
    return { valid: false, message: "Missing 'name' in frontmatter" };
  }
  if (!frontmatter["description"]) {
    return { valid: false, message: "Missing 'description' in frontmatter" };
  }
  const name = frontmatter["name"].trim();
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        valid: false,
        message: `Name '${name}' should be kebab-case (lowercase letters, digits, and hyphens only)`
      };
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      return {
        valid: false,
        message: `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`
      };
    }
    if (name.length > 64) {
      return {
        valid: false,
        message: `Name is too long (${name.length} characters). Maximum is 64 characters.`
      };
    }
  }
  const description = frontmatter["description"].trim();
  if (description) {
    if (description.includes("<") || description.includes(">")) {
      return {
        valid: false,
        message: "Description cannot contain angle brackets (< or >)"
      };
    }
    if (description.length > 1024) {
      return {
        valid: false,
        message: `Description is too long (${description.length} characters). Maximum is 1024 characters.`
      };
    }
  }
  const compatibility = frontmatter["compatibility"];
  if (compatibility) {
    if (compatibility.length > 500) {
      return {
        valid: false,
        message: `Compatibility is too long (${compatibility.length} characters). Maximum is 500 characters.`
      };
    }
  }
  return { valid: true, message: "Skill is valid!" };
}

// lib/utils.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
function parseSkillMd(skillPath) {
  const content = readFileSync2(join2(skillPath, "SKILL.md"), "utf-8");
  const lines = content.split(`
`);
  if (lines[0].trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)");
  }
  let endIdx = null;
  for (let i = 1;i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === null) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)");
  }
  let name = "";
  let description = "";
  const frontmatterLines = lines.slice(1, endIdx);
  let i = 0;
  while (i < frontmatterLines.length) {
    const line = frontmatterLines[i];
    if (line.startsWith("name:")) {
      name = line.slice("name:".length).trim().replace(/^['"]|['"]$/g, "");
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim();
      if ([">", "|", ">-", "|-"].includes(value)) {
        const continuationLines = [];
        i++;
        while (i < frontmatterLines.length && (frontmatterLines[i].startsWith("  ") || frontmatterLines[i].startsWith("\t"))) {
          continuationLines.push(frontmatterLines[i].trim());
          i++;
        }
        description = continuationLines.join(" ");
        continue;
      } else {
        description = value.replace(/^['"]|['"]$/g, "");
      }
    }
    i++;
  }
  return { name, description, fullContent: content };
}

// lib/run-eval.ts
import {
  cpSync,
  existsSync as existsSync2,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "fs";
import { dirname, join as join3, parse } from "path";
import { randomBytes } from "crypto";
import { tmpdir as osTmpdir } from "os";

// lib/process.ts
import { spawn } from "child_process";
function isFailedExitCode(exitCode) {
  return exitCode != null && exitCode !== 0;
}
function isFailedProcess(result) {
  return result.timedOut || isFailedExitCode(result.exitCode);
}
function runProcess(command, opts) {
  return new Promise((resolve, reject) => {
    const [file, ...args] = command;
    if (!file) {
      reject(new Error("Cannot spawn an empty command"));
      return;
    }
    const maxStderrChars = opts.maxStderrChars ?? 64 * 1024;
    const killGraceMs = opts.killGraceMs ?? 1000;
    const proc = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let stopRequested = false;
    let killTimeoutId;
    const requestStop = () => {
      if (settled || stopRequested)
        return;
      stopRequested = true;
      proc.kill();
      killTimeoutId = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGKILL");
        }
      }, killGraceMs);
    };
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
      killTimeoutId = setTimeout(() => {
        if (!settled) {
          proc.kill("SIGKILL");
        }
      }, killGraceMs);
    }, opts.timeoutMs);
    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
      const shouldStop = opts.onStdoutChunk?.(chunk);
      if (shouldStop)
        requestStop();
    });
    proc.stderr.setEncoding("utf-8");
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxStderrChars) {
        stderr = stderr.slice(-maxStderrChars);
      }
    });
    proc.on("error", (error) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeoutId);
      if (killTimeoutId)
        clearTimeout(killTimeoutId);
      reject(error);
    });
    proc.on("close", (exitCode) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeoutId);
      if (killTimeoutId)
        clearTimeout(killTimeoutId);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

// lib/run-eval.ts
var SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var ALL_ZERO_WARNING = "All should-trigger queries produced 0 triggers with no run errors. Check that trigger evals are using an agent that exposes skill tool events, such as the build agent.";
function buildOpenCodeRunCommand(query, opts) {
  const cmd = [
    "opencode",
    "run",
    "--format",
    "json",
    "--agent",
    opts.agent ?? "build"
  ];
  if (opts.model)
    cmd.push("--model", opts.model);
  cmd.push(query);
  return cmd;
}
function buildEvalWarnings(results) {
  const shouldTriggerResults = results.filter((r) => r.should_trigger);
  if (shouldTriggerResults.length === 0)
    return [];
  const allZeroWithoutErrors = shouldTriggerResults.every((r) => r.triggers === 0 && r.errors === 0);
  return allZeroWithoutErrors ? [ALL_ZERO_WARNING] : [];
}
function parseCliSkillList(stdoutText) {
  try {
    const parsed = JSON.parse(stdoutText);
    if (!Array.isArray(parsed))
      return null;
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object")
        return [];
      const record = entry;
      if (typeof record.name !== "string")
        return [];
      return [
        {
          name: record.name,
          location: typeof record.location === "string" ? record.location : undefined
        }
      ];
    });
  } catch {
    return null;
  }
}
function findSkillConflictsInList(skills, skillName) {
  return skills.filter((entry) => entry.name === skillName).map((entry) => typeof entry.location === "string" && entry.location.trim() ? entry.location : "unknown location");
}
var cliInstalledSkillEnumerator = async (projectRoot) => {
  let result;
  try {
    result = await runProcess(["opencode", "debug", "skill"], {
      cwd: projectRoot,
      timeoutMs: 1e4
    });
  } catch {
    return null;
  }
  if (isFailedProcess(result))
    return null;
  return parseCliSkillList(result.stdout);
};
function skillConflictMessage(skillName, locations) {
  return `skill_eval conflict: skill "${skillName}" is already available to opencode at ${locations.join(", ")}. Remove that installed skill or its skills.paths entry before running skill_eval. The eval tool creates a synthetic skill named "${skillName}-skill-<id>" and only counts that temporary skill as triggered; an installed skill with the base name can steal triggers and produce false negatives.`;
}
function skillEnumerationUnavailableMessage(skillName) {
  return `skill_eval aborted: could not enumerate the skills installed in this project to check whether "${skillName}" is already available. A pre-installed skill with the base name can steal triggers and produce false negatives, so the eval does not run rather than return misleading results. In OpenCode V2 the plugin uses the skill list API; if that call fails, retry once the server is healthy. In V1 the check uses \`opencode debug skill\`.`;
}
async function assertNoInstalledSkillConflict(skillName, projectRoot, enumerate = cliInstalledSkillEnumerator) {
  const skills = await enumerate(projectRoot);
  if (skills === null) {
    throw new Error(skillEnumerationUnavailableMessage(skillName));
  }
  const locations = findSkillConflictsInList(skills, skillName);
  if (locations.length === 0)
    return;
  throw new Error(skillConflictMessage(skillName, locations));
}
function createV2SkillEnumerator(ctx) {
  return async (projectRoot) => {
    try {
      const output = await ctx.skill.list({
        location: { directory: projectRoot }
      });
      if (!output || !Array.isArray(output.data))
        return null;
      return output.data.flatMap((entry) => {
        if (!entry || typeof entry.name !== "string")
          return [];
        return [
          {
            name: entry.name,
            location: typeof entry.path === "string" ? entry.path : undefined
          }
        ];
      });
    } catch {
      return null;
    }
  };
}
function findProjectRoot(cwd) {
  let current = cwd ?? process.cwd();
  const { root } = parse(current);
  while (true) {
    if (existsSync2(join3(current, ".opencode")))
      return current;
    if (existsSync2(join3(current, ".claude")))
      return current;
    const parent = dirname(current);
    if (parent === current || parent === root)
      break;
    current = parent;
  }
  return cwd ?? process.cwd();
}
function linkOrCopyConfigEntry(source, target, isDirectory) {
  try {
    symlinkSync(source, target, isDirectory ? "dir" : "file");
  } catch {
    cpSync(source, target, { recursive: true });
  }
}
function symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName) {
  const sourceOpenCode = join3(projectRoot, ".opencode");
  if (!existsSync2(sourceOpenCode))
    return;
  const targetOpenCode = join3(evalRoot, ".opencode");
  mkdirSync(targetOpenCode, { recursive: true });
  for (const entry of readdirSync(sourceOpenCode, { withFileTypes: true })) {
    if (entry.name === "skills")
      continue;
    linkOrCopyConfigEntry(join3(sourceOpenCode, entry.name), join3(targetOpenCode, entry.name), entry.isDirectory());
  }
  const sourceSkills = join3(sourceOpenCode, "skills");
  if (!existsSync2(sourceSkills))
    return;
  const targetSkills = join3(targetOpenCode, "skills");
  mkdirSync(targetSkills, { recursive: true });
  for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
    if (entry.name === skillName)
      continue;
    linkOrCopyConfigEntry(join3(sourceSkills, entry.name), join3(targetSkills, entry.name), entry.isDirectory());
  }
}
async function runSingleQuery(query, skillName, skillDescription, timeout, projectRoot, agent, triggerOnly, model) {
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(`Invalid skill name "${skillName}". Expected kebab-case (lowercase letters, numbers, and hyphens only).`);
  }
  const uniqueId = randomBytes(4).toString("hex");
  const cleanName = `${skillName}-skill-${uniqueId}`;
  const evalRoot = mkdtempSync(join3(osTmpdir(), "opencode-skill-eval-"));
  const skillsDir = join3(evalRoot, ".opencode", "skills", cleanName);
  const skillFile = join3(skillsDir, "SKILL.md");
  try {
    symlinkProjectOpenCodeConfig(projectRoot, evalRoot, skillName);
    mkdirSync(skillsDir, { recursive: true });
    const indentedDesc = skillDescription.split(`
`).join(`
  `);
    const skillContent = [
      "---",
      `name: ${cleanName}`,
      "description: |",
      `  ${indentedDesc}`,
      "---",
      "",
      `# ${skillName}`,
      "",
      `This skill handles: ${skillDescription}`,
      ""
    ].join(`
`);
    writeFileSync(skillFile, skillContent);
    const cmd = buildOpenCodeRunCommand(query, { agent, model });
    let buffer = "";
    let triggered = false;
    const maxStderrChars = 64 * 1024;
    const timeoutMs = timeout * 1000;
    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed)
        return;
      try {
        const event = JSON.parse(trimmed);
        if (event.type !== "tool_use")
          return;
        const part = event.part;
        if (!part || typeof part !== "object")
          return;
        const toolName = typeof part.tool === "string" ? part.tool : "";
        if (toolName !== "skill" && toolName !== "read")
          return;
        const serialized = JSON.stringify(part);
        if (serialized.includes(cleanName)) {
          triggered = true;
        }
      } catch {}
    };
    const flushBuffer = (final = false) => {
      let newlineIndex = buffer.indexOf(`
`);
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        consumeLine(line);
        newlineIndex = buffer.indexOf(`
`);
      }
      if (final && buffer.trim()) {
        consumeLine(buffer);
        buffer = "";
      }
    };
    const result = await runProcess(cmd, {
      cwd: evalRoot,
      env: { ...process.env, PWD: evalRoot },
      timeoutMs,
      maxStderrChars,
      onStdoutChunk(chunk) {
        buffer += chunk;
        flushBuffer();
        return triggerOnly && triggered;
      }
    });
    flushBuffer(true);
    if (triggered && triggerOnly) {
      return true;
    }
    if (isFailedProcess(result)) {
      const cleanedStderr = result.stderr.trim();
      throw new Error(cleanedStderr ? `opencode run exited ${result.exitCode}: ${cleanedStderr}` : `opencode run exited ${result.exitCode}`);
    }
    return triggered;
  } finally {
    if (existsSync2(evalRoot)) {
      rmSync(evalRoot, { recursive: true, force: true });
    }
  }
}
async function runEval(opts) {
  const {
    evalSet,
    skillName,
    description,
    numWorkers,
    timeout,
    projectRoot,
    runsPerQuery = 3,
    triggerThreshold = 0.5,
    triggerOnly = true,
    model,
    agent = "build"
  } = opts;
  const jobs = [];
  for (const item of evalSet) {
    for (let r = 0;r < runsPerQuery; r++) {
      jobs.push({ item, runIdx: r });
    }
  }
  const jobResults = [];
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      if (!job)
        break;
      try {
        const triggered = await runSingleQuery(job.item.query, skillName, description, timeout, projectRoot, agent, triggerOnly, model);
        jobResults.push({
          query: job.item.query,
          triggered,
          item: job.item,
          errored: false
        });
      } catch (e) {
        console.error(`Warning: query failed: ${e}`);
        jobResults.push({
          query: job.item.query,
          triggered: false,
          item: job.item,
          errored: true
        });
      }
    }
  }
  const workers = Array.from({ length: Math.min(numWorkers, jobs.length) }, () => worker());
  await Promise.all(workers);
  const queryTriggers = new Map;
  const queryErrors = new Map;
  const queryItems = new Map;
  for (const jr of jobResults) {
    if (!queryTriggers.has(jr.query))
      queryTriggers.set(jr.query, []);
    queryTriggers.get(jr.query).push(jr.triggered);
    queryErrors.set(jr.query, (queryErrors.get(jr.query) ?? 0) + (jr.errored ? 1 : 0));
    queryItems.set(jr.query, jr.item);
  }
  const results = [];
  for (const [query, triggers] of queryTriggers) {
    const item = queryItems.get(query);
    const errors = queryErrors.get(query) ?? 0;
    const successfulRuns = triggers.length - errors;
    const triggerRate = successfulRuns > 0 ? triggers.filter(Boolean).length / successfulRuns : 0;
    const shouldTrigger = item.should_trigger;
    const thresholdPass = shouldTrigger ? triggerRate >= triggerThreshold : triggerRate < triggerThreshold;
    const didPass = errors === 0 && thresholdPass;
    results.push({
      query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      successful_runs: successfulRuns,
      errors,
      pass: didPass
    });
  }
  const passed = results.filter((r) => r.pass).length;
  const runErrors = results.reduce((acc, r) => acc + r.errors, 0);
  const queriesWithErrors = results.filter((r) => r.errors > 0).length;
  return {
    skill_name: skillName,
    description,
    results,
    warnings: buildEvalWarnings(results),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      run_errors: runErrors,
      queries_with_errors: queriesWithErrors
    }
  };
}

// lib/improve-description.ts
import { mkdirSync as mkdirSync2, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { join as join4 } from "path";
import { tmpdir } from "os";
import { randomBytes as randomBytes2 } from "crypto";

// lib/failure-taxonomy.ts
function classifyEvalFailures(results) {
  return results.filter((result) => !result.pass).map((result) => {
    if (result.errors > 0) {
      return {
        category: "run_error",
        query: result.query,
        explanation: "The eval run had execution errors, so trigger accuracy is not trustworthy.",
        remediation: "Fix the eval execution error before optimizing this description."
      };
    }
    if (result.should_trigger) {
      return {
        category: "false_negative",
        query: result.query,
        explanation: "The skill should have triggered but did not.",
        remediation: "Broaden the description around this intent without listing only this exact query."
      };
    }
    return {
      category: "false_positive",
      query: result.query,
      explanation: "The skill triggered for a query that should not use it.",
      remediation: "Add clearer boundaries for when not to use the skill."
    };
  });
}
function formatFailureDiagnostics(diagnostics) {
  if (diagnostics.length === 0)
    return "";
  return diagnostics.map((diagnostic) => `- [${diagnostic.category}] ${diagnostic.query}: ${diagnostic.explanation} ${diagnostic.remediation}`).join(`
`);
}

// lib/improve-description.ts
async function callOpenCode(prompt, model, timeout = 300) {
  const tmpPath = join4(tmpdir(), `skill-creator-${randomBytes2(6).toString("hex")}.md`);
  writeFileSync2(tmpPath, prompt);
  try {
    const cmd = ["opencode", "run", "--format", "json"];
    if (model)
      cmd.push("--model", model);
    cmd.push("--file", tmpPath, "--", "Process the attached file and follow its instructions.");
    let stdout = "";
    let lineBuffer = "";
    const textParts = [];
    const maxStderrChars = 64 * 1024;
    const timeoutMs = timeout * 1000;
    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed)
        return;
      try {
        const event = JSON.parse(trimmed);
        if (event.type !== "text")
          return;
        const part = event.part;
        if (!part || typeof part !== "object")
          return;
        const text = part.text;
        if (typeof text === "string") {
          textParts.push(text);
        }
      } catch {}
    };
    const flushLines = (final = false) => {
      let idx = lineBuffer.indexOf(`
`);
      while (idx !== -1) {
        const line = lineBuffer.slice(0, idx);
        lineBuffer = lineBuffer.slice(idx + 1);
        consumeLine(line);
        idx = lineBuffer.indexOf(`
`);
      }
      if (final && lineBuffer.trim()) {
        consumeLine(lineBuffer);
        lineBuffer = "";
      }
    };
    const result = await runProcess(cmd, {
      env: { ...process.env },
      timeoutMs,
      maxStderrChars,
      onStdoutChunk(chunk) {
        stdout += chunk;
        lineBuffer += chunk;
        flushLines();
      }
    });
    flushLines(true);
    if (isFailedProcess(result)) {
      throw new Error(`opencode run exited ${result.exitCode}
stderr: ${result.stderr}`);
    }
    if (textParts.length > 0) {
      return textParts.join("");
    }
    return stdout;
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {}
  }
}
async function improveDescription(opts) {
  const {
    skillName,
    skillContent,
    currentDescription,
    evalResults,
    history,
    model,
    testResults,
    logDir,
    iteration
  } = opts;
  const failedTriggers = evalResults.results.filter((r) => r.should_trigger && !r.pass);
  const falseTriggers = evalResults.results.filter((r) => !r.should_trigger && !r.pass);
  const trainScore = `${evalResults.summary.passed}/${evalResults.summary.total}`;
  let scoresSummary;
  if (testResults) {
    const testScore = `${testResults.summary.passed}/${testResults.summary.total}`;
    scoresSummary = `Train: ${trainScore}, Test: ${testScore}`;
  } else {
    scoresSummary = `Train: ${trainScore}`;
  }
  let prompt = `You are optimizing a skill description for an OpenCode skill called "${skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that the agent sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in the agent's "available_skills" list. When a user sends a query, the agent decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
`;
  if (failedTriggers.length > 0) {
    prompt += `FAILED TO TRIGGER (should have triggered but didn't):
`;
    for (const r of failedTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)
`;
    }
    prompt += `
`;
  }
  if (falseTriggers.length > 0) {
    prompt += `FALSE TRIGGERS (triggered but shouldn't have):
`;
    for (const r of falseTriggers) {
      prompt += `  - "${r.query}" (triggered ${r.triggers}/${r.runs} times)
`;
    }
    prompt += `
`;
  }
  if (history.length > 0) {
    prompt += `PREVIOUS ATTEMPTS (do NOT repeat these \u2014 try something structurally different):

`;
    for (const h of history) {
      const trainS = `${h.train_passed ?? h.passed ?? 0}/${h.train_total ?? h.total ?? 0}`;
      const testS = h.test_passed != null ? `${h.test_passed}/${h.test_total ?? "?"}` : null;
      const scoreStr = `train=${trainS}` + (testS ? `, test=${testS}` : "");
      prompt += `<attempt ${scoreStr}>
`;
      prompt += `Description: "${h.description}"
`;
      if (h.results) {
        prompt += `Train results:
`;
        for (const r of h.results) {
          const status = r.pass ? "PASS" : "FAIL";
          prompt += `  [${status}] "${r.query.slice(0, 80)}" (triggered ${r.triggers}/${r.runs})
`;
        }
      }
      if (h.note) {
        prompt += `Note: ${h.note}
`;
      }
      prompt += `</attempt>

`;
    }
  }
  const diagnostics = formatFailureDiagnostics(classifyEvalFailures(evalResults.results ?? []));
  const failureDiagnosticsSection = diagnostics ? `
FAILURE DIAGNOSTICS:
${diagnostics}
` : "";
  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters \u2014 descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for the agent's attention \u2014 make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.
${failureDiagnosticsSection}

Please respond with only the new description text in <new_description> tags, nothing else.`;
  let text = await callOpenCode(prompt, model);
  const match = text.match(/<new_description>([\s\S]*?)<\/new_description>/);
  let description = match ? match[1].trim().replace(/^["']|["']$/g, "") : text.trim().replace(/^["']|["']$/g, "");
  const transcript = {
    iteration,
    prompt,
    response: text,
    parsed_description: description,
    char_count: description.length,
    over_limit: description.length > 1024
  };
  if (description.length > 1024) {
    const shortenPrompt = `${prompt}

` + `---

` + `A previous attempt produced this description, which at ` + `${description.length} characters is over the 1024-character hard limit:

` + `"${description}"

` + `Rewrite it to be under 1024 characters while keeping the most ` + `important trigger words and intent coverage. Respond with only ` + `the new description in <new_description> tags.`;
    const shortenText = await callOpenCode(shortenPrompt, model);
    const shortenMatch = shortenText.match(/<new_description>([\s\S]*?)<\/new_description>/);
    const shortened = shortenMatch ? shortenMatch[1].trim().replace(/^["']|["']$/g, "") : shortenText.trim().replace(/^["']|["']$/g, "");
    transcript.rewrite_prompt = shortenPrompt;
    transcript.rewrite_response = shortenText;
    transcript.rewrite_description = shortened;
    transcript.rewrite_char_count = shortened.length;
    description = shortened;
  }
  transcript.final_description = description;
  if (logDir) {
    mkdirSync2(logDir, { recursive: true });
    const logFile = join4(logDir, `improve_iter_${iteration ?? "unknown"}.json`);
    writeFileSync2(logFile, JSON.stringify(transcript, null, 2));
  }
  return description;
}

// lib/run-loop.ts
import { writeFileSync as writeFileSync3 } from "fs";

// lib/report.ts
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function generateHtml(data, opts = {}) {
  const d = data;
  const { autoRefresh = false, skillName = "" } = opts;
  const history = d.history ?? [];
  const titlePrefix = skillName ? escapeHtml(skillName) + " \u2014 " : "";
  const trainQueries = [];
  const testQueries = [];
  if (history.length > 0) {
    const first = history[0];
    for (const r of first.train_results ?? first.results ?? []) {
      trainQueries.push({ query: r.query, should_trigger: r.should_trigger ?? true });
    }
    if (first.test_results) {
      for (const r of first.test_results) {
        testQueries.push({ query: r.query, should_trigger: r.should_trigger ?? true });
      }
    }
  }
  const refreshTag = autoRefresh ? `    <meta http-equiv="refresh" content="5">
` : "";
  const parts = [];
  parts.push(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
${refreshTag}    <title>${titlePrefix}Skill Description Optimization</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Lora:wght@400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Lora', Georgia, serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #faf9f5;
            color: #141413;
        }
        h1 { font-family: 'Poppins', sans-serif; color: #141413; }
        .explainer {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
            color: #b0aea5;
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
        }
        .summary p { margin: 5px 0; }
        .best { color: #788c5d; font-weight: bold; }
        .table-container {
            overflow-x: auto;
            width: 100%;
        }
        table {
            border-collapse: collapse;
            background: white;
            border: 1px solid #e8e6dc;
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #e8e6dc;
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-family: 'Poppins', sans-serif;
            background: #141413;
            color: #faf9f5;
            font-weight: 500;
        }
        th.test-col {
            background: #6a9bcc;
        }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result {
            text-align: center;
            font-size: 16px;
            min-width: 40px;
        }
        td.test-result {
            background: #f0f6fc;
        }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .rate {
            font-size: 9px;
            color: #b0aea5;
            display: block;
        }
        tr:hover { background: #faf9f5; }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok { background: #fef3c7; color: #d97706; }
        .score-bad { background: #fceaea; color: #c44; }
        .train-label { color: #b0aea5; font-size: 10px; }
        .test-label { color: #6a9bcc; font-size: 10px; font-weight: bold; }
        .best-row { background: #f5f8f2; }
        th.positive-col { border-bottom: 3px solid #788c5d; }
        th.negative-col { border-bottom: 3px solid #c44; }
        th.test-col.positive-col { border-bottom: 3px solid #788c5d; }
        th.test-col.negative-col { border-bottom: 3px solid #c44; }
        .legend { font-family: 'Poppins', sans-serif; display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #788c5d; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test { background: #6a9bcc; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
    <h1>${titlePrefix}Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> This page updates automatically as OpenCode tests different versions of your skill's description. Each row is an iteration \u2014 a new description attempt. The columns show test queries: green checkmarks mean the skill triggered correctly (or correctly didn't trigger), red crosses mean it got it wrong. The "Train" score shows performance on queries used to improve the description; the "Test" score shows performance on held-out queries the optimizer hasn't seen. When it's done, OpenCode will apply the best-performing description to your skill.
    </div>
`);
  parts.push(`
    <div class="summary">
        <p><strong>Original:</strong> ${escapeHtml(d.original_description ?? "N/A")}</p>
        <p class="best"><strong>Best:</strong> ${escapeHtml(d.best_description ?? "N/A")}</p>
        <p><strong>Best Score:</strong> ${d.best_score ?? "N/A"} ${d.best_test_score ? "(test)" : "(train)"}</p>
        <p><strong>Iterations:</strong> ${d.iterations_run ?? 0} | <strong>Train:</strong> ${d.train_size ?? "?"} | <strong>Test:</strong> ${d.test_size ?? "?"}</p>
    </div>
`);
  parts.push(`
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
`);
  parts.push(`
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
`);
  for (const qinfo of trainQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    parts.push(`                <th class="${polarity}">${escapeHtml(qinfo.query)}</th>
`);
  }
  for (const qinfo of testQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    parts.push(`                <th class="test-col ${polarity}">${escapeHtml(qinfo.query)}</th>
`);
  }
  parts.push(`            </tr>
        </thead>
        <tbody>
`);
  let bestIter;
  if (testQueries.length > 0) {
    bestIter = history.reduce((best, h) => (h.test_passed ?? 0) >= (best.test_passed ?? 0) ? h : best).iteration;
  } else {
    bestIter = history.reduce((best, h) => (h.train_passed ?? h.passed ?? 0) >= (best.train_passed ?? best.passed ?? 0) ? h : best).iteration;
  }
  function aggregateRuns(results) {
    let correct = 0;
    let total = 0;
    for (const r of results) {
      total += r.runs;
      if (r.should_trigger ?? true) {
        correct += r.triggers;
      } else {
        correct += r.runs - r.triggers;
      }
    }
    return [correct, total];
  }
  function scoreClass(correct, total) {
    if (total > 0) {
      const ratio = correct / total;
      if (ratio >= 0.8)
        return "score-good";
      if (ratio >= 0.5)
        return "score-ok";
    }
    return "score-bad";
  }
  for (const h of history) {
    const iteration = h.iteration ?? "?";
    const description = h.description ?? "";
    const trainResults = h.train_results ?? h.results ?? [];
    const testResults = h.test_results ?? [];
    const trainByQuery = new Map(trainResults.map((r) => [r.query, r]));
    const testByQuery = new Map((testResults ?? []).map((r) => [r.query, r]));
    const [trainCorrect, trainRuns] = aggregateRuns(trainResults);
    const [testCorrect, testRuns] = aggregateRuns(testResults ?? []);
    const trainClass = scoreClass(trainCorrect, trainRuns);
    const testClass = scoreClass(testCorrect, testRuns);
    const rowClass = iteration === bestIter ? "best-row" : "";
    parts.push(`            <tr class="${rowClass}">
                <td>${iteration}</td>
                <td><span class="score ${trainClass}">${trainCorrect}/${trainRuns}</span></td>
                <td><span class="score ${testClass}">${testCorrect}/${testRuns}</span></td>
                <td class="description">${escapeHtml(description)}</td>
`);
    for (const qinfo of trainQueries) {
      const r = trainByQuery.get(qinfo.query);
      const didPass = r?.pass ?? false;
      const triggers = r?.triggers ?? 0;
      const runs = r?.runs ?? 0;
      const icon = didPass ? "\u2713" : "\u2717";
      const cssClass = didPass ? "pass" : "fail";
      parts.push(`                <td class="result ${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>
`);
    }
    for (const qinfo of testQueries) {
      const r = testByQuery.get(qinfo.query);
      const didPass = r?.pass ?? false;
      const triggers = r?.triggers ?? 0;
      const runs = r?.runs ?? 0;
      const icon = didPass ? "\u2713" : "\u2717";
      const cssClass = didPass ? "pass" : "fail";
      parts.push(`                <td class="result test-result ${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>
`);
    }
    parts.push(`            </tr>
`);
  }
  parts.push(`        </tbody>
    </table>
    </div>

</body>
</html>
`);
  return parts.join("");
}

// lib/run-loop.ts
function splitEvalSet(evalSet, holdout, seed = 42) {
  let state = seed;
  function rand() {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) % 1e4 / 1e4;
  }
  const trigger = evalSet.filter((e) => e.should_trigger);
  const noTrigger = evalSet.filter((e) => !e.should_trigger);
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1;i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const shuffledTrigger = shuffle(trigger);
  const shuffledNoTrigger = shuffle(noTrigger);
  const nTriggerTest = Math.max(1, Math.floor(shuffledTrigger.length * holdout));
  const nNoTriggerTest = Math.max(1, Math.floor(shuffledNoTrigger.length * holdout));
  const testSet = [
    ...shuffledTrigger.slice(0, nTriggerTest),
    ...shuffledNoTrigger.slice(0, nNoTriggerTest)
  ];
  const trainSet = [
    ...shuffledTrigger.slice(nTriggerTest),
    ...shuffledNoTrigger.slice(nNoTriggerTest)
  ];
  return [trainSet, testSet];
}
async function runLoop(opts) {
  const {
    evalSet,
    skillPath,
    descriptionOverride,
    numWorkers,
    timeout,
    maxIterations,
    runsPerQuery,
    triggerThreshold,
    triggerOnly,
    holdout,
    model,
    agent,
    verbose,
    liveReportPath,
    logDir
  } = opts;
  const projectRoot = findProjectRoot();
  const { name, description: originalDescription, fullContent: content } = parseSkillMd(skillPath);
  let currentDescription = descriptionOverride ?? originalDescription;
  let trainSet;
  let testSet;
  if (holdout > 0) {
    [trainSet, testSet] = splitEvalSet(evalSet, holdout);
    if (verbose) {
      console.error(`Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})`);
    }
  } else {
    trainSet = evalSet;
    testSet = [];
  }
  const history = [];
  let exitReason = "unknown";
  for (let iteration = 1;iteration <= maxIterations; iteration++) {
    if (verbose) {
      console.error(`
${"=".repeat(60)}`);
      console.error(`Iteration ${iteration}/${maxIterations}`);
      console.error(`Description: ${currentDescription}`);
      console.error("=".repeat(60));
    }
    const allQueries = [...trainSet, ...testSet];
    const t0 = Date.now();
    const allResults = await runEval({
      evalSet: allQueries,
      skillName: name,
      description: currentDescription,
      numWorkers,
      timeout,
      projectRoot,
      runsPerQuery,
      triggerThreshold,
      triggerOnly,
      model,
      agent
    });
    const evalElapsed = (Date.now() - t0) / 1000;
    const trainQueriesSet = new Set(trainSet.map((q) => q.query));
    const trainResultList = allResults.results.filter((r) => trainQueriesSet.has(r.query));
    const testResultList = allResults.results.filter((r) => !trainQueriesSet.has(r.query));
    const trainWarnings = buildEvalWarnings(trainResultList);
    const testWarnings = buildEvalWarnings(testResultList);
    const trainPassed = trainResultList.filter((r) => r.pass).length;
    const trainTotal = trainResultList.length;
    const trainRunErrors = trainResultList.reduce((acc, r) => acc + r.errors, 0);
    const trainSummary = {
      passed: trainPassed,
      failed: trainTotal - trainPassed,
      total: trainTotal,
      run_errors: trainRunErrors,
      queries_with_errors: trainResultList.filter((r) => r.errors > 0).length
    };
    const trainResults = {
      skill_name: name,
      description: currentDescription,
      results: trainResultList,
      warnings: trainWarnings,
      summary: trainSummary
    };
    let testResults = null;
    let testSummary = null;
    if (testSet.length > 0) {
      const testPassed = testResultList.filter((r) => r.pass).length;
      const testTotal = testResultList.length;
      const testRunErrors = testResultList.reduce((acc, r) => acc + r.errors, 0);
      testSummary = {
        passed: testPassed,
        failed: testTotal - testPassed,
        total: testTotal,
        run_errors: testRunErrors,
        queries_with_errors: testResultList.filter((r) => r.errors > 0).length
      };
      testResults = {
        skill_name: name,
        description: currentDescription,
        results: testResultList,
        warnings: testWarnings,
        summary: testSummary
      };
    }
    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainSummary.passed,
      train_failed: trainSummary.failed,
      train_total: trainSummary.total,
      train_results: trainResultList,
      test_passed: testSummary?.passed ?? null,
      test_failed: testSummary?.failed ?? null,
      test_total: testSummary?.total ?? null,
      test_results: testResultList.length > 0 ? testResultList : null,
      passed: trainSummary.passed,
      failed: trainSummary.failed,
      total: trainSummary.total,
      results: trainResultList
    });
    if (liveReportPath) {
      const partialOutput = {
        original_description: originalDescription,
        best_description: currentDescription,
        best_score: "in progress",
        iterations_run: history.length,
        holdout,
        train_size: trainSet.length,
        test_size: testSet.length,
        history
      };
      writeFileSync3(liveReportPath, generateHtml(partialOutput, { autoRefresh: true, skillName: name }));
    }
    if (verbose) {
      console.error(`Train: ${trainSummary.passed}/${trainSummary.total} passed (${evalElapsed.toFixed(1)}s)`);
      if (testSummary) {
        console.error(`Test:  ${testSummary.passed}/${testSummary.total} passed`);
      }
      for (const warning of new Set([...trainWarnings, ...testWarnings])) {
        console.error(`Warning: ${warning}`);
      }
    }
    if (trainSummary.failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`;
      if (verbose) {
        console.error(`
All train queries passed on iteration ${iteration}!`);
      }
      break;
    }
    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`;
      if (verbose) {
        console.error(`
Max iterations reached (${maxIterations}).`);
      }
      break;
    }
    if (verbose) {
      console.error(`
Improving description...`);
    }
    const t1 = Date.now();
    const blindedHistory = history.map((h) => {
      const stripped = {};
      for (const [k, v] of Object.entries(h)) {
        if (!k.startsWith("test_"))
          stripped[k] = v;
      }
      return stripped;
    });
    const newDescription = await improveDescription({
      skillName: name,
      skillContent: content,
      currentDescription,
      evalResults: trainResults,
      history: blindedHistory,
      model,
      logDir,
      iteration
    });
    const improveElapsed = (Date.now() - t1) / 1000;
    if (verbose) {
      console.error(`Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}`);
    }
    currentDescription = newDescription;
  }
  let best;
  if (testSet.length > 0) {
    best = history.reduce((a, b) => (a.test_passed ?? 0) >= (b.test_passed ?? 0) ? a : b);
  } else {
    best = history.reduce((a, b) => (a.train_passed ?? 0) >= (b.train_passed ?? 0) ? a : b);
  }
  const bestScore = testSet.length > 0 ? `${best.test_passed}/${best.test_total}` : `${best.train_passed}/${best.train_total}`;
  if (verbose) {
    console.error(`
Exit reason: ${exitReason}`);
    console.error(`Best score: ${bestScore} (iteration ${best.iteration})`);
  }
  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: testSet.length > 0 ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout,
    train_size: trainSet.length,
    test_size: testSet.length,
    history
  };
}

// lib/aggregate.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, readdirSync as readdirSync2, statSync } from "fs";
import { join as join5, basename } from "path";
function compareEvalIds(a, b) {
  const parseNumeric = (value) => {
    if (typeof value === "number" && Number.isFinite(value))
      return value;
    if (typeof value !== "string")
      return null;
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed))
      return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  };
  const aNum = parseNumeric(a);
  const bNum = parseNumeric(b);
  if (aNum !== null && bNum !== null)
    return aNum - bNum;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
function computeRunsPerConfiguration(results, evalIds) {
  const counts = [];
  for (const runs of Object.values(results)) {
    if (runs.length === 0) {
      counts.push(0);
      continue;
    }
    const byEval = new Map;
    for (const run of runs) {
      const evalKey = String(run.eval_id);
      if (!byEval.has(evalKey)) {
        byEval.set(evalKey, new Set);
      }
      byEval.get(evalKey).add(run.run_number);
    }
    if (evalIds.length === 0) {
      counts.push(0);
      continue;
    }
    for (const evalId of evalIds) {
      const set = byEval.get(String(evalId));
      counts.push(set ? set.size : 0);
    }
  }
  if (counts.length === 0)
    return 0;
  return Math.min(...counts);
}
function calculateStats(values) {
  if (values.length === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0 };
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let stddev = 0;
  if (n > 1) {
    const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
    stddev = Math.sqrt(variance);
  }
  return {
    mean: Math.round(mean * 1e4) / 1e4,
    stddev: Math.round(stddev * 1e4) / 1e4,
    min: Math.round(Math.min(...values) * 1e4) / 1e4,
    max: Math.round(Math.max(...values) * 1e4) / 1e4
  };
}
function sortedDirs(dir, pattern) {
  if (!existsSync3(dir))
    return [];
  return readdirSync2(dir).filter((name) => {
    const full = join5(dir, name);
    return statSync(full).isDirectory() && (!pattern || pattern.test(name));
  }).sort().map((name) => join5(dir, name));
}
function loadRunResults(benchmarkDir) {
  const runsDir = join5(benchmarkDir, "runs");
  let searchDir;
  if (existsSync3(runsDir)) {
    searchDir = runsDir;
  } else if (sortedDirs(benchmarkDir, /^eval-/).length > 0) {
    searchDir = benchmarkDir;
  } else {
    console.error(`No eval directories found in ${benchmarkDir} or ${runsDir}`);
    return { results: {}, evalIds: [] };
  }
  const results = {};
  const evalIds = new Set;
  for (const [evalIdx, evalDir] of sortedDirs(searchDir, /^eval-/).entries()) {
    const metadataPath = join5(evalDir, "eval_metadata.json");
    let evalId = evalIdx;
    if (existsSync3(metadataPath)) {
      try {
        const meta = JSON.parse(readFileSync3(metadataPath, "utf-8"));
        evalId = meta.eval_id ?? evalIdx;
      } catch {}
    } else {
      const parsedEvalId = Number.parseInt(basename(evalDir).split("-")[1] ?? "", 10);
      if (Number.isFinite(parsedEvalId)) {
        evalId = parsedEvalId;
      }
    }
    let hasLoadedRuns = false;
    for (const configDir of sortedDirs(evalDir)) {
      if (sortedDirs(configDir, /^run-/).length === 0)
        continue;
      const config = basename(configDir);
      if (!results[config])
        results[config] = [];
      for (const runDir of sortedDirs(configDir, /^run-/)) {
        const parsedRunNumber = Number.parseInt(basename(runDir).split("-")[1] ?? "", 10);
        if (!Number.isFinite(parsedRunNumber)) {
          console.error(`Warning: Invalid run directory name: ${runDir}`);
          continue;
        }
        const runNumber = parsedRunNumber;
        const gradingFile = join5(runDir, "grading.json");
        if (!existsSync3(gradingFile)) {
          console.error(`Warning: grading.json not found in ${runDir}`);
          continue;
        }
        let grading;
        try {
          grading = JSON.parse(readFileSync3(gradingFile, "utf-8"));
        } catch (e) {
          console.error(`Warning: Invalid JSON in ${gradingFile}: ${e}`);
          continue;
        }
        const summary = grading.summary ?? {};
        const result = {
          eval_id: evalId,
          run_number: runNumber,
          pass_rate: summary.pass_rate ?? 0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: 0,
          tokens: 0,
          tool_calls: 0,
          errors: 0,
          expectations: grading.expectations ?? [],
          notes: []
        };
        const timing = grading.timing ?? {};
        result.time_seconds = timing.total_duration_seconds ?? 0;
        const timingFile = join5(runDir, "timing.json");
        if (result.time_seconds === 0 && existsSync3(timingFile)) {
          try {
            const timingData = JSON.parse(readFileSync3(timingFile, "utf-8"));
            result.time_seconds = timingData.total_duration_seconds ?? 0;
            result.tokens = timingData.total_tokens ?? 0;
          } catch {}
        }
        const metrics = grading.execution_metrics ?? {};
        result.tool_calls = metrics.total_tool_calls ?? 0;
        if (!result.tokens)
          result.tokens = metrics.output_chars ?? 0;
        result.errors = metrics.errors_encountered ?? 0;
        for (const exp of result.expectations) {
          if (!("text" in exp) || !("passed" in exp)) {
            console.error(`Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence)`);
          }
        }
        const notesSummary = grading.user_notes_summary ?? {};
        const notes = [];
        if (notesSummary.uncertainties)
          notes.push(...notesSummary.uncertainties);
        if (notesSummary.needs_review)
          notes.push(...notesSummary.needs_review);
        if (notesSummary.workarounds)
          notes.push(...notesSummary.workarounds);
        result.notes = notes;
        results[config].push(result);
        hasLoadedRuns = true;
      }
    }
    if (hasLoadedRuns) {
      evalIds.add(evalId);
    }
  }
  return {
    results,
    evalIds: [...evalIds].sort(compareEvalIds)
  };
}
function aggregateResults(results) {
  const runSummary = {};
  const configs = Object.keys(results);
  if (configs.length === 0) {
    runSummary.delta = {
      pass_rate: "+0.00",
      time_seconds: "+0.0",
      tokens: "+0"
    };
    return runSummary;
  }
  for (const config of configs) {
    const runs = results[config] ?? [];
    if (runs.length === 0) {
      runSummary[config] = {
        pass_rate: { mean: 0, stddev: 0, min: 0, max: 0 },
        time_seconds: { mean: 0, stddev: 0, min: 0, max: 0 },
        tokens: { mean: 0, stddev: 0, min: 0, max: 0 }
      };
      continue;
    }
    runSummary[config] = {
      pass_rate: calculateStats(runs.map((r) => r.pass_rate)),
      time_seconds: calculateStats(runs.map((r) => r.time_seconds)),
      tokens: calculateStats(runs.map((r) => r.tokens))
    };
  }
  const primary = runSummary[configs[0]] ?? {};
  const baselineSummary = configs.length >= 2 ? runSummary[configs[1]] ?? {} : {};
  const deltaPR = (primary.pass_rate?.mean ?? 0) - (baselineSummary.pass_rate?.mean ?? 0);
  const deltaTime = (primary.time_seconds?.mean ?? 0) - (baselineSummary.time_seconds?.mean ?? 0);
  const deltaTokens = (primary.tokens?.mean ?? 0) - (baselineSummary.tokens?.mean ?? 0);
  runSummary.delta = {
    pass_rate: `${deltaPR >= 0 ? "+" : ""}${deltaPR.toFixed(2)}`,
    time_seconds: `${deltaTime >= 0 ? "+" : ""}${deltaTime.toFixed(1)}`,
    tokens: `${deltaTokens >= 0 ? "+" : ""}${Math.round(deltaTokens)}`
  };
  return runSummary;
}
function generateBenchmark(benchmarkDir, skillName = "", skillPath = "") {
  const loaded = loadRunResults(benchmarkDir);
  const results = loaded.results;
  const runSummary = aggregateResults(results);
  const runs = [];
  for (const config of Object.keys(results)) {
    for (const result of results[config]) {
      runs.push({
        eval_id: result.eval_id,
        configuration: config,
        run_number: result.run_number,
        result: {
          pass_rate: result.pass_rate,
          passed: result.passed,
          failed: result.failed,
          total: result.total,
          time_seconds: result.time_seconds,
          tokens: result.tokens,
          tool_calls: result.tool_calls,
          errors: result.errors
        },
        expectations: result.expectations,
        notes: result.notes
      });
    }
  }
  const runsPerConfiguration = computeRunsPerConfiguration(results, loaded.evalIds);
  return {
    metadata: {
      skill_name: skillName || "<skill-name>",
      skill_path: skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: loaded.evalIds,
      runs_per_configuration: runsPerConfiguration
    },
    runs,
    run_summary: runSummary,
    notes: []
  };
}
function generateMarkdown(benchmark) {
  const metadata = benchmark.metadata;
  const runSummary = benchmark.run_summary;
  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const configA = configs[0] ?? "config_a";
  const configB = configs[1] ?? "config_b";
  const labelA = configA.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const labelB = configB.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const a = runSummary[configA] ?? {};
  const b = runSummary[configB] ?? {};
  const delta = runSummary.delta ?? {};
  const lines = [
    `# Skill Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${(metadata.evals_run ?? []).join(", ")} (${metadata.runs_per_configuration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${labelA} | ${labelB} | Delta |`,
    "|--------|------------|---------------|-------|"
  ];
  const fmtPR = (s) => s && typeof s.mean === "number" && typeof s.stddev === "number" ? `${(s.mean * 100).toFixed(0)}% \xB1 ${(s.stddev * 100).toFixed(0)}%` : "\u2014";
  const fmtTime = (s) => s && typeof s.mean === "number" && typeof s.stddev === "number" ? `${s.mean.toFixed(1)}s \xB1 ${s.stddev.toFixed(1)}s` : "\u2014";
  const fmtTokens = (s) => s && typeof s.mean === "number" && typeof s.stddev === "number" ? `${s.mean.toFixed(0)} \xB1 ${s.stddev.toFixed(0)}` : "\u2014";
  lines.push(`| Pass Rate | ${fmtPR(a.pass_rate)} | ${fmtPR(b.pass_rate)} | ${delta.pass_rate ?? "\u2014"} |`);
  lines.push(`| Time | ${fmtTime(a.time_seconds)} | ${fmtTime(b.time_seconds)} | ${delta.time_seconds ?? "\u2014"}s |`);
  lines.push(`| Tokens | ${fmtTokens(a.tokens)} | ${fmtTokens(b.tokens)} | ${delta.tokens ?? "\u2014"} |`);
  if (benchmark.notes?.length) {
    lines.push("", "## Notes", "");
    for (const note of benchmark.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join(`
`);
}

// lib/review-server.ts
import { spawn as spawn2 } from "child_process";
import {
  existsSync as existsSync4,
  mkdirSync as mkdirSync3,
  readFileSync as readFileSync4,
  readdirSync as readdirSync3,
  statSync as statSync2,
  writeFileSync as writeFileSync5
} from "fs";
import { createServer } from "http";
import { basename as basename2, extname, join as join6, relative } from "path";
var METADATA_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"]);
var TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".sh",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sql",
  ".r",
  ".toml"
]);
var IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
var MAX_FEEDBACK_BODY_BYTES = 1e6;
var MIME_OVERRIDES = {
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};
function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext in MIME_OVERRIDES)
    return MIME_OVERRIDES[ext];
  const mimeMap = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".zip": "application/zip"
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
function embedFile(filePath) {
  const name = basename2(filePath);
  const ext = extname(filePath).toLowerCase();
  const mime = getMimeType(filePath);
  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      const content = readFileSync4(filePath, "utf-8");
      return { name, type: "text", content };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const raw = readFileSync4(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "image", mime, data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (ext === ".pdf") {
    try {
      const raw = readFileSync4(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "pdf", data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  if (ext === ".xlsx") {
    try {
      const raw = readFileSync4(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "xlsx", data_b64: b64 };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
  try {
    const raw = readFileSync4(filePath);
    const b64 = raw.toString("base64");
    return { name, type: "binary", mime, data_uri: `data:${mime};base64,${b64}` };
  } catch {
    return { name, type: "error", content: "(Error reading file)" };
  }
}
function findRunsRecursive(root, current, runs) {
  if (!existsSync4(current) || !statSync2(current).isDirectory())
    return;
  const outputsDir = join6(current, "outputs");
  if (existsSync4(outputsDir) && statSync2(outputsDir).isDirectory()) {
    const run = buildRun(root, current);
    if (run)
      runs.push(run);
    return;
  }
  const skip = new Set(["node_modules", ".git", "__pycache__", "skill", "inputs"]);
  const entries = readdirSync3(current).sort();
  for (const entry of entries) {
    const full = join6(current, entry);
    if (statSync2(full).isDirectory() && !skip.has(entry)) {
      findRunsRecursive(root, full, runs);
    }
  }
}
function findRuns(workspace) {
  const runs = [];
  findRunsRecursive(workspace, workspace, runs);
  runs.sort((a, b) => {
    const aId = typeof a.eval_id === "number" ? a.eval_id : Infinity;
    const bId = typeof b.eval_id === "number" ? b.eval_id : Infinity;
    if (aId !== bId)
      return aId - bId;
    return a.id.localeCompare(b.id);
  });
  return runs;
}
function buildRun(root, runDir) {
  let prompt = "";
  let evalId = null;
  for (const candidate of [join6(runDir, "eval_metadata.json"), join6(runDir, "..", "eval_metadata.json")]) {
    if (existsSync4(candidate)) {
      try {
        const metadata = JSON.parse(readFileSync4(candidate, "utf-8"));
        prompt = metadata.prompt ?? "";
        evalId = metadata.eval_id ?? null;
      } catch {}
      if (prompt)
        break;
    }
  }
  if (!prompt) {
    for (const candidate of [join6(runDir, "transcript.md"), join6(runDir, "outputs", "transcript.md")]) {
      if (existsSync4(candidate)) {
        try {
          const text = readFileSync4(candidate, "utf-8");
          const match = text.match(/## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/);
          if (match)
            prompt = match[1].trim();
        } catch {}
        if (prompt)
          break;
      }
    }
  }
  if (!prompt)
    prompt = "(No prompt found)";
  const runId = relative(root, runDir).replace(/[/\\]/g, "-");
  const outputsDir = join6(runDir, "outputs");
  const outputFiles = [];
  if (existsSync4(outputsDir) && statSync2(outputsDir).isDirectory()) {
    const files = readdirSync3(outputsDir).sort();
    for (const f of files) {
      const full = join6(outputsDir, f);
      if (statSync2(full).isFile() && !METADATA_FILES.has(f)) {
        outputFiles.push(embedFile(full));
      }
    }
  }
  let grading = null;
  for (const candidate of [join6(runDir, "grading.json"), join6(runDir, "..", "grading.json")]) {
    if (existsSync4(candidate)) {
      try {
        grading = JSON.parse(readFileSync4(candidate, "utf-8"));
      } catch {}
      if (grading)
        break;
    }
  }
  return { id: runId, prompt, eval_id: evalId, outputs: outputFiles, grading };
}
function isValidFeedbackPayload(value) {
  if (typeof value !== "object" || value === null)
    return false;
  if (!Object.prototype.hasOwnProperty.call(value, "reviews"))
    return false;
  const record = value;
  if (!Array.isArray(record.reviews))
    return false;
  for (const item of record.reviews) {
    if (typeof item !== "object" || item === null)
      return false;
    const review = item;
    if (typeof review.run_id !== "string")
      return false;
    if (typeof review.feedback !== "string")
      return false;
    if (Object.prototype.hasOwnProperty.call(review, "timestamp") && typeof review.timestamp !== "string") {
      return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(record, "status") && typeof record.status !== "string") {
    return false;
  }
  return true;
}
function loadPreviousIteration(workspace) {
  const result = {};
  const feedbackMap = {};
  const feedbackPath = join6(workspace, "feedback.json");
  if (existsSync4(feedbackPath)) {
    try {
      const data = JSON.parse(readFileSync4(feedbackPath, "utf-8"));
      for (const r of data.reviews ?? []) {
        if (r.feedback?.trim()) {
          feedbackMap[r.run_id] = r.feedback;
        }
      }
    } catch {}
  }
  const prevRuns = findRuns(workspace);
  for (const run of prevRuns) {
    result[run.id] = {
      feedback: feedbackMap[run.id] ?? "",
      outputs: run.outputs ?? []
    };
  }
  for (const [runId, fb] of Object.entries(feedbackMap)) {
    if (!(runId in result)) {
      result[runId] = { feedback: fb, outputs: [] };
    }
  }
  return result;
}
function generateReviewHtml(opts) {
  const { runs, skillName, previous, benchmark, templatePath } = opts;
  const template = readFileSync4(templatePath, "utf-8");
  const previousFeedback = {};
  const previousOutputs = {};
  if (previous) {
    for (const [runId, data] of Object.entries(previous)) {
      if (data.feedback)
        previousFeedback[runId] = data.feedback;
      if (data.outputs?.length)
        previousOutputs[runId] = data.outputs;
    }
  }
  const embedded = {
    skill_name: skillName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs
  };
  if (benchmark)
    embedded.benchmark = benchmark;
  const dataJson = JSON.stringify(embedded);
  return template.replace("/*__EMBEDDED_DATA__*/", `const EMBEDDED_DATA = ${dataJson};`);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
    Object.setPrototypeOf(this, PayloadTooLargeError.prototype);
  }
}
function readStream(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let rejected = false;
    stream.setEncoding("utf-8");
    stream.on("data", (chunk) => {
      if (rejected)
        return;
      const chunkBytes = Buffer.byteLength(chunk, "utf-8");
      if (bytes + chunkBytes > maxBytes) {
        rejected = true;
        reject(new PayloadTooLargeError);
        return;
      }
      bytes += chunkBytes;
      body += chunk;
    });
    stream.on("end", () => {
      if (!rejected)
        resolve(body);
    });
    stream.on("error", reject);
  });
}
function isAddressInUse(error) {
  return error instanceof Error && error.code === "EADDRINUSE";
}
function jsonResponse(body, status = 200) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
function textResponse(body, status = 200, contentType = "text/plain") {
  return {
    status,
    headers: { "Content-Type": contentType },
    body
  };
}
async function handleReviewRequest(method, requestUrl, requestBody, context) {
  const url = new URL(requestUrl, "http://localhost");
  if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const runs = findRuns(context.workspace);
    let benchmark = null;
    if (context.benchmarkPath && existsSync4(context.benchmarkPath)) {
      try {
        benchmark = JSON.parse(readFileSync4(context.benchmarkPath, "utf-8"));
      } catch {}
    }
    const html = generateReviewHtml({
      runs,
      skillName: context.skillName,
      previous: context.previous,
      benchmark,
      templatePath: context.templatePath
    });
    return textResponse(html, 200, "text/html; charset=utf-8");
  }
  if (method === "GET" && url.pathname === "/api/feedback") {
    let data = "{}";
    if (existsSync4(context.feedbackPath)) {
      try {
        data = readFileSync4(context.feedbackPath, "utf-8");
      } catch {}
    }
    return textResponse(data, 200, "application/json");
  }
  if (method === "POST" && url.pathname === "/api/feedback") {
    let body;
    try {
      body = JSON.parse(requestBody);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 400);
    }
    if (!isValidFeedbackPayload(body)) {
      return jsonResponse({ error: "Expected JSON object with a valid 'reviews' array" }, 400);
    }
    try {
      writeFileSync5(context.feedbackPath, JSON.stringify(body, null, 2) + `
`);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500);
    }
    return jsonResponse({ ok: true });
  }
  return textResponse("Not Found", 404);
}
async function handleNodeRequest(req, res, context) {
  try {
    const body = req.method === "POST" ? await readStream(req, MAX_FEEDBACK_BODY_BYTES) : "";
    const result = await handleReviewRequest(req.method ?? "GET", req.url ?? "/", body, context);
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}
async function bindReviewServer(server, port) {
  try {
    await listen(server, port);
    return;
  } catch (error) {
    if (isAddressInUse(error)) {
      throw new Error(`Review server port ${port} is already in use by another process. Stop that process or pass a different port (skill_serve_review accepts a "port" argument, and port 0 picks a free port).`);
    }
    throw error;
  }
}
function closeServer(server, sockets) {
  for (const socket of sockets) {
    socket.destroy();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error)
        reject(error);
      else
        resolve();
    });
  });
}
async function serveReview(opts) {
  const {
    workspace,
    port = 3117,
    skillName: skillNameOpt,
    previousWorkspace,
    benchmarkPath,
    templatePath,
    openBrowser = true
  } = opts;
  if (!existsSync4(workspace) || !statSync2(workspace).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${workspace}`);
  }
  const skillName = skillNameOpt ?? basename2(workspace).replace(/-workspace$/, "");
  const feedbackPath = join6(workspace, "feedback.json");
  let previous = null;
  if (previousWorkspace && existsSync4(previousWorkspace)) {
    previous = loadPreviousIteration(previousWorkspace);
  }
  const context = {
    workspace,
    skillName,
    feedbackPath,
    previous,
    benchmarkPath,
    templatePath
  };
  const server = createServer((req, res) => {
    handleNodeRequest(req, res, context);
  });
  const sockets = new Set;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  await bindReviewServer(server, port);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Review server did not bind to a TCP port");
  }
  const actualPort = address.port;
  const serverUrl = `http://localhost:${actualPort}`;
  if (openBrowser) {
    try {
      const openProc = spawn2("open", [serverUrl], {
        detached: true,
        stdio: "ignore"
      });
      openProc.unref();
    } catch {}
  }
  return {
    server,
    url: serverUrl,
    feedbackPath,
    stop: () => closeServer(server, sockets)
  };
}
function exportStaticReview(opts) {
  const {
    workspace,
    outputPath,
    skillName: skillNameOpt,
    previousWorkspace,
    benchmarkPath,
    templatePath
  } = opts;
  const skillName = skillNameOpt ?? basename2(workspace).replace(/-workspace$/, "");
  const runs = findRuns(workspace);
  if (runs.length === 0) {
    throw new Error(`No runs found in ${workspace}`);
  }
  let previous = null;
  if (previousWorkspace && existsSync4(previousWorkspace)) {
    previous = loadPreviousIteration(previousWorkspace);
  }
  let benchmark = null;
  if (benchmarkPath && existsSync4(benchmarkPath)) {
    try {
      benchmark = JSON.parse(readFileSync4(benchmarkPath, "utf-8"));
    } catch {}
  }
  const html = generateReviewHtml({
    runs,
    skillName,
    previous,
    benchmark,
    templatePath
  });
  const parentDir = join6(outputPath, "..");
  mkdirSync3(parentDir, { recursive: true });
  writeFileSync5(outputPath, html);
  return outputPath;
}

// lib/workflow-guard.ts
import { existsSync as existsSync5, readdirSync as readdirSync4, statSync as statSync3 } from "fs";
import { basename as basename3, join as join7 } from "path";
function sortedDirs2(dir, pattern) {
  if (!existsSync5(dir) || !statSync3(dir).isDirectory())
    return [];
  return readdirSync4(dir).map((name) => join7(dir, name)).filter((full) => statSync3(full).isDirectory()).filter((full) => pattern ? pattern.test(basename3(full)) : true).sort();
}
function hasAtLeastOneRun(configDir) {
  const runDirs = sortedDirs2(configDir, /^run-/);
  if (runDirs.length > 0)
    return true;
  const outputsDir = join7(configDir, "outputs");
  return existsSync5(outputsDir) && statSync3(outputsDir).isDirectory();
}
function validateComparisonWorkspace(workspace) {
  const issues = [];
  const foundConfigs = new Set;
  if (!existsSync5(workspace)) {
    return {
      valid: false,
      evalCount: 0,
      issues: [
        {
          evalDir: basename3(workspace),
          issue: "workspace path does not exist"
        }
      ],
      foundConfigs: [],
      searchRoot: workspace
    };
  }
  if (!statSync3(workspace).isDirectory()) {
    return {
      valid: false,
      evalCount: 0,
      issues: [
        {
          evalDir: basename3(workspace),
          issue: "workspace path is not a directory"
        }
      ],
      foundConfigs: [],
      searchRoot: workspace
    };
  }
  let searchRoot = workspace;
  let evalDirs = sortedDirs2(searchRoot, /^eval-/);
  if (evalDirs.length === 0) {
    const runsRoot = join7(workspace, "runs");
    const nested = sortedDirs2(runsRoot, /^eval-/);
    if (nested.length > 0) {
      searchRoot = runsRoot;
      evalDirs = nested;
    }
  }
  if (evalDirs.length === 0) {
    issues.push({
      evalDir: basename3(workspace),
      issue: "no eval-* directories found (expected evals with with_skill and baseline runs)"
    });
  }
  for (const evalDir of evalDirs) {
    const withSkillDir = join7(evalDir, "with_skill");
    const withoutSkillDir = join7(evalDir, "without_skill");
    const oldSkillDir = join7(evalDir, "old_skill");
    if (existsSync5(withSkillDir) && statSync3(withSkillDir).isDirectory()) {
      foundConfigs.add("with_skill");
    }
    if (existsSync5(withoutSkillDir) && statSync3(withoutSkillDir).isDirectory()) {
      foundConfigs.add("without_skill");
    }
    if (existsSync5(oldSkillDir) && statSync3(oldSkillDir).isDirectory()) {
      foundConfigs.add("old_skill");
    }
    const hasWithSkill = existsSync5(withSkillDir) && statSync3(withSkillDir).isDirectory() && hasAtLeastOneRun(withSkillDir);
    const hasWithoutSkill = existsSync5(withoutSkillDir) && statSync3(withoutSkillDir).isDirectory() && hasAtLeastOneRun(withoutSkillDir);
    const hasOldSkill = existsSync5(oldSkillDir) && statSync3(oldSkillDir).isDirectory() && hasAtLeastOneRun(oldSkillDir);
    if (!hasWithSkill) {
      issues.push({
        evalDir: basename3(evalDir),
        issue: "missing with_skill run outputs"
      });
    }
    if (!hasWithoutSkill && !hasOldSkill) {
      issues.push({
        evalDir: basename3(evalDir),
        issue: "missing baseline run outputs (without_skill or old_skill)"
      });
    }
  }
  return {
    valid: issues.length === 0,
    evalCount: evalDirs.length,
    issues,
    foundConfigs: [...foundConfigs].sort(),
    searchRoot
  };
}

// lib/gold-standards.ts
import {
  existsSync as existsSync6,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync5,
  renameSync,
  writeFileSync as writeFileSync6
} from "fs";
import { randomUUID } from "crypto";
import { basename as basename4, dirname as dirname2, join as join8 } from "path";
function readStore(path) {
  if (!existsSync6(path))
    return [];
  try {
    return JSON.parse(readFileSync5(path, "utf-8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to read gold standards store at ${path}: malformed JSON`);
    }
    throw error;
  }
}
function sortStandards(standards) {
  return [...standards].sort((a, b) => b.passRate - a.passRate);
}
function writeStore(path, standards) {
  const dir = dirname2(path);
  mkdirSync4(dir, { recursive: true });
  const tmpPath = join8(dir, `.${basename4(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync6(tmpPath, JSON.stringify(sortStandards(standards).slice(0, 50), null, 2));
  renameSync(tmpPath, path);
}
function listGoldStandards(path) {
  return sortStandards(readStore(path));
}
function addGoldStandard(path, input) {
  if (!Number.isFinite(input.passRate) || input.passRate < 0 || input.passRate > 1) {
    throw new Error("passRate must be a finite number between 0 and 1");
  }
  const standard = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
  writeStore(path, [...readStore(path), standard]);
  return standard;
}
function removeGoldStandard(path, id) {
  const standards = readStore(path);
  const remaining = standards.filter((standard) => standard.id !== id);
  if (remaining.length === standards.length)
    return false;
  writeStore(path, remaining);
  return true;
}
function getGoldAdvice(path) {
  const standards = listGoldStandards(path).slice(0, 5);
  if (standards.length === 0)
    return "";
  const examples = standards.map((standard) => {
    const percent = Math.round(standard.passRate * 100);
    const notes = standard.notes ? ` Notes: ${standard.notes}` : "";
    return `- ${standard.skillName} (${percent}%): ${standard.description}${notes}`;
  });
  return ["GOLD STANDARD EXAMPLES:", ...examples].join(`
`);
}

// lib/skill-install.ts
import {
  copyFileSync,
  existsSync as existsSync7,
  mkdirSync as mkdirSync5,
  readdirSync as readdirSync5,
  readFileSync as readFileSync6,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync4,
  writeFileSync as writeFileSync7
} from "fs";
import { join as join9 } from "path";
var SKILL_NAME = "opencode-skill-creator";
var LEGACY_SKILL_NAME = "skill-creator";
var INSTALL_VERSION_FILE = ".opencode-skill-creator-version";
function copyDirRecursive(src, dest) {
  mkdirSync5(dest, { recursive: true });
  for (const entry of readdirSync5(src)) {
    const srcPath = join9(src, entry);
    const destPath = join9(dest, entry);
    if (statSync4(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
function defaultBackupTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}
function uniqueBackupDir(skillsRoot, timestamp) {
  const base = join9(skillsRoot, `${LEGACY_SKILL_NAME}.opencode-skill-creator-backup-${timestamp}`);
  if (!existsSync7(base))
    return base;
  for (let index = 1;index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existsSync7(candidate))
      return candidate;
  }
  throw new Error("Could not find an available legacy skill backup path");
}
function archiveLegacySkill(args) {
  const legacyVersionFile = join9(args.legacySkillDir, INSTALL_VERSION_FILE);
  if (!existsSync7(legacyVersionFile))
    return;
  const backupDir = uniqueBackupDir(args.skillsRoot, args.backupTimestamp());
  const backupSkillFile = join9(args.legacySkillDir, "SKILL.md");
  if (existsSync7(backupSkillFile)) {
    renameSync2(backupSkillFile, join9(args.legacySkillDir, "SKILL.md.backup"));
  }
  renameSync2(args.legacySkillDir, backupDir);
}
function ensureBundledSkillInstalled(options) {
  const skillsRoot = join9(options.configDir, "opencode", "skills");
  const skillsDir = join9(skillsRoot, SKILL_NAME);
  const legacySkillDir = join9(skillsRoot, LEGACY_SKILL_NAME);
  const marker = join9(skillsDir, "SKILL.md");
  const versionFile = join9(skillsDir, INSTALL_VERSION_FILE);
  const userSkillFile = join9(skillsDir, "SKILL.md");
  const userSkillBackup = join9(skillsDir, "SKILL.md.user-backup");
  if (!existsSync7(options.bundledSkillDir))
    return;
  let installedVersion = "";
  if (existsSync7(versionFile)) {
    try {
      installedVersion = readFileSync6(versionFile, "utf-8").trim();
    } catch {
      installedVersion = "";
    }
  }
  const shouldInstall = !existsSync7(marker) || installedVersion !== options.packageVersion;
  const tmpInstallDir = `${skillsDir}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (shouldInstall) {
      copyDirRecursive(options.bundledSkillDir, tmpInstallDir);
      if (existsSync7(userSkillFile)) {
        try {
          copyFileSync(userSkillFile, userSkillBackup);
        } catch (error) {
          options.onError?.(`Failed to back up existing user skill file before updating ${SKILL_NAME}`, error);
        }
        try {
          copyFileSync(userSkillFile, join9(tmpInstallDir, "SKILL.md"));
        } catch {}
      }
      if (!existsSync7(skillsDir)) {
        renameSync2(tmpInstallDir, skillsDir);
      } else {
        copyDirRecursive(tmpInstallDir, skillsDir);
      }
      writeFileSync7(versionFile, `${options.packageVersion}
`);
    }
    if (existsSync7(legacySkillDir)) {
      archiveLegacySkill({
        skillsRoot,
        legacySkillDir,
        backupTimestamp: options.backupTimestamp ?? defaultBackupTimestamp
      });
    }
  } catch (error) {
    options.onError?.("Failed to install opencode-skill-creator skill", error);
  } finally {
    if (existsSync7(tmpInstallDir)) {
      rmSync2(tmpInstallDir, { recursive: true, force: true });
    }
  }
}

// skill-creator.ts
var PLUGIN_DIR = dirname3(fileURLToPath(import.meta.url));
var TEMPLATES_DIR = join10(PLUGIN_DIR, "templates");
var BUNDLED_SKILL_DIR = join10(PLUGIN_DIR, "skill");
var PACKAGE_JSON_PATH = join10(PLUGIN_DIR, "package.json");
var AUTO_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
var AUTO_UPDATE_STATUS_FILE = "opencode-skill-creator-update-check.json";
var NPM_REGISTRY_URL = "https://registry.npmjs.org/opencode-skill-creator/latest";
var AUTO_UPDATE_TIMEOUT_MS = 2500;
var GOLD_STANDARDS_PATH = join10(homedir(), ".config", "opencode", "gold-standards.json");
var PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync7(PACKAGE_JSON_PATH, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
function prepareReviewLaunch(args) {
  const strictMode = !(args.allowPartial ?? false);
  const validation = validateComparisonWorkspace(args.workspace);
  if (strictMode && !validation.valid) {
    const issueLines = validation.issues.map((issue) => `- ${issue.evalDir}: ${issue.issue}`);
    throw new Error([
      `Strict review preflight failed for ${args.workspace}.`,
      "Preflight issues:",
      ...issueLines,
      "Resolve the issues above, or set allowPartial=true to override."
    ].join(`
`));
  }
  let resolvedBenchmarkPath = args.benchmarkPath ?? null;
  if (!resolvedBenchmarkPath) {
    try {
      const benchmark = generateBenchmark(args.workspace, args.skillName ?? "", "");
      const jsonPath = join10(args.workspace, "benchmark.json");
      const mdPath = join10(args.workspace, "benchmark.md");
      writeFileSync8(jsonPath, JSON.stringify(benchmark, null, 2));
      writeFileSync8(mdPath, generateMarkdown(benchmark));
      resolvedBenchmarkPath = jsonPath;
    } catch {
      resolvedBenchmarkPath = null;
    }
  }
  return {
    strictMode,
    allowPartial: args.allowPartial ?? false,
    validation,
    benchmarkPath: resolvedBenchmarkPath
  };
}
function normalizeDescriptionOverride(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function getAutoUpdatePaths() {
  const cacheDir = process.env.XDG_CACHE_HOME || join10(homedir(), ".cache");
  const configDir = process.env.XDG_CONFIG_HOME || join10(homedir(), ".config");
  const packageCacheRoot = join10(cacheDir, "opencode", "packages", "opencode-skill-creator@latest");
  return {
    packageCacheRoot,
    cachedPackageDir: join10(packageCacheRoot, "node_modules", "opencode-skill-creator"),
    cachedPackageJson: join10(packageCacheRoot, "node_modules", "opencode-skill-creator", "package.json"),
    statusPath: join10(configDir, "opencode", AUTO_UPDATE_STATUS_FILE)
  };
}
function compareVersions(a, b) {
  const parse = (value) => value.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0;index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0)
      return diff > 0 ? 1 : -1;
  }
  return 0;
}
function readAutoUpdateStatus(path) {
  try {
    return JSON.parse(readFileSync7(path, "utf-8"));
  } catch {
    return {};
  }
}
function writeAutoUpdateStatus(path, status) {
  try {
    mkdirSync6(dirname3(path), { recursive: true });
    writeFileSync8(path, `${JSON.stringify(status, null, 2)}
`, "utf-8");
  } catch {}
}
function isInsidePath(parent, child, pathModule = {
  isAbsolute,
  relative: relative2,
  sep
}) {
  const rel = pathModule.relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !pathModule.isAbsolute(rel) && !rel.startsWith("/") && !rel.startsWith("\\") && !rel.includes(`..${pathModule.sep}`);
}
function scheduleCacheClear(path) {
  process.once("exit", () => {
    try {
      rmSync3(path, { recursive: true, force: true });
    } catch {}
  });
}
async function maybeAutoRefreshPluginCache(options = {}) {
  try {
    if (process.env.OPENCODE_SKILL_CREATOR_AUTO_UPDATE === "0") {
      return { checked: false, cleared: false, reason: "disabled" };
    }
    const currentVersion = options.currentVersion ?? PACKAGE_VERSION;
    if (currentVersion === "0.0.0") {
      return { checked: false, cleared: false, reason: "unknown-version" };
    }
    const paths = getAutoUpdatePaths();
    const now = options.now ?? Date.now();
    const status = readAutoUpdateStatus(paths.statusPath);
    if (typeof status.lastCheckedAt === "number" && now - status.lastCheckedAt < AUTO_UPDATE_TTL_MS) {
      return { checked: false, cleared: false, reason: "recently-checked" };
    }
    const controller = new AbortController;
    const timeout = setTimeout(() => controller.abort(), AUTO_UPDATE_TIMEOUT_MS);
    try {
      const response = await (options.fetchImpl ?? fetch)(NPM_REGISTRY_URL, {
        signal: controller.signal
      });
      if (!response.ok)
        return { checked: false, cleared: false, reason: "error" };
      const metadata = await response.json();
      const latestVersion = metadata.version;
      if (!latestVersion)
        return { checked: false, cleared: false, reason: "error" };
      writeAutoUpdateStatus(paths.statusPath, {
        lastCheckedAt: now,
        currentVersion,
        latestVersion
      });
      if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { checked: true, cleared: false, reason: "up-to-date" };
      }
      if (!existsSync8(paths.cachedPackageJson)) {
        return { checked: true, cleared: false, reason: "missing-cache" };
      }
      const currentPluginDir = options.currentPluginDir ?? PLUGIN_DIR;
      if (isInsidePath(paths.packageCacheRoot, currentPluginDir)) {
        (options.scheduleClearImpl ?? scheduleCacheClear)(paths.packageCacheRoot);
        return { checked: true, cleared: false, reason: "scheduled-clear" };
      }
      rmSync3(paths.packageCacheRoot, { recursive: true, force: true });
      return { checked: true, cleared: true, reason: "newer-version" };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { checked: false, cleared: false, reason: "error" };
  }
}
function createPluginInstance(overrides = {}) {
  return {
    projectRoot: () => findProjectRoot(),
    enumerate: cliInstalledSkillEnumerator,
    servers: new Map,
    ...overrides
  };
}
var initialized = false;
async function initialize() {
  if (initialized)
    return;
  initialized = true;
  ensureBundledSkillInstalled({
    bundledSkillDir: BUNDLED_SKILL_DIR,
    configDir: process.env.XDG_CONFIG_HOME || join10(homedir(), ".config"),
    packageVersion: PACKAGE_VERSION,
    onError: (message, error) => console.warn(message, error)
  });
  maybeAutoRefreshPluginCache();
}
function deriveJsonSchema(args) {
  const schema = tool.schema;
  const jsonSchema = schema.toJSONSchema(schema.object(args ?? {}));
  const { $schema: _dialect, ...rest } = jsonSchema;
  return rest;
}
function buildPluginTools(instance) {
  return {
    tool: {
      skill_validate: tool({
        description: "Validate a skill directory. Checks that SKILL.md exists with well-formed YAML frontmatter, required fields, naming conventions, and description limits.",
        args: {
          skillPath: tool.schema.string().describe("Path to the skill directory containing SKILL.md")
        },
        async execute(args) {
          const result = validateSkill(args.skillPath);
          return JSON.stringify(result, null, 2);
        }
      }),
      skill_parse: tool({
        description: "Parse a SKILL.md file and return its name, description, and full content.",
        args: {
          skillPath: tool.schema.string().describe("Path to the skill directory containing SKILL.md")
        },
        async execute(args) {
          const meta = parseSkillMd(args.skillPath);
          return JSON.stringify({
            name: meta.name,
            description: meta.description,
            content: meta.fullContent,
            contentLength: meta.fullContent.length
          }, null, 2);
        }
      }),
      skill_add_gold_standard: tool({
        description: "Save a durable gold-standard skill description example for future meta-learning experiments.",
        args: {
          skillName: tool.schema.string().describe("Skill name for this example"),
          description: tool.schema.string().describe("High-performing skill description"),
          passRate: tool.schema.number().describe("Observed pass rate as a decimal from 0 to 1"),
          notes: tool.schema.string().optional().describe("Optional notes about why this example worked")
        },
        async execute(args) {
          const standard = addGoldStandard(GOLD_STANDARDS_PATH, {
            skillName: args.skillName,
            description: args.description,
            passRate: args.passRate,
            notes: args.notes
          });
          return JSON.stringify(standard, null, 2);
        }
      }),
      skill_list_gold_standards: tool({
        description: "List saved gold-standard skill description examples.",
        args: {},
        async execute() {
          return JSON.stringify(listGoldStandards(GOLD_STANDARDS_PATH), null, 2);
        }
      }),
      skill_remove_gold_standard: tool({
        description: "Remove a saved gold-standard skill description example by id.",
        args: {
          id: tool.schema.string().describe("Gold-standard example id")
        },
        async execute(args) {
          return JSON.stringify({
            removed: removeGoldStandard(GOLD_STANDARDS_PATH, args.id)
          });
        }
      }),
      skill_get_gold_advice: tool({
        description: "Return formatted gold-standard advice for description optimization prompts.",
        args: {},
        async execute() {
          return JSON.stringify({ advice: getGoldAdvice(GOLD_STANDARDS_PATH) });
        }
      }),
      skill_eval: tool({
        description: "Test whether a skill description causes OpenCode to invoke the skill for a set of queries. Runs each query against `opencode run` and checks if the skill was triggered. Returns pass/fail results per query.",
        args: {
          evalSetPath: tool.schema.string().describe("Path to eval_set.json (array of {query, should_trigger})"),
          skillPath: tool.schema.string().describe("Path to the skill directory containing SKILL.md"),
          descriptionOverride: tool.schema.string().optional().describe("Override description to test (uses SKILL.md description if omitted)"),
          numWorkers: tool.schema.number().optional().describe("Parallel workers (default: 10)"),
          timeout: tool.schema.number().optional().describe("Timeout per query in seconds (default: 30)"),
          runsPerQuery: tool.schema.number().optional().describe("Number of runs per query for reliability (default: 3)"),
          triggerThreshold: tool.schema.number().optional().describe("Trigger rate threshold to count as triggered (default: 0.5)"),
          triggerOnly: tool.schema.boolean().optional().describe("Stop each eval run as soon as the synthetic skill is triggered and ignore later workflow failures (default: true)"),
          model: tool.schema.string().optional().describe("Model ID in provider/model format"),
          agent: tool.schema.string().optional().describe("OpenCode agent for trigger eval runs (default: build)")
        },
        async execute(args) {
          const { readFileSync } = await import("fs");
          const evalSet = JSON.parse(readFileSync(args.evalSetPath, "utf-8"));
          const validation = validateSkill(args.skillPath);
          if (!validation.valid) {
            throw new Error(`Invalid skill at ${args.skillPath}: ${validation.message}`);
          }
          const meta = parseSkillMd(args.skillPath);
          const projectRoot = instance.projectRoot();
          await assertNoInstalledSkillConflict(meta.name, projectRoot, instance.enumerate);
          const result = await runEval({
            evalSet,
            skillName: meta.name,
            description: normalizeDescriptionOverride(args.descriptionOverride) ?? meta.description,
            numWorkers: args.numWorkers ?? 10,
            timeout: args.timeout ?? 30,
            projectRoot,
            runsPerQuery: args.runsPerQuery ?? 3,
            triggerThreshold: args.triggerThreshold ?? 0.5,
            triggerOnly: args.triggerOnly ?? true,
            model: args.model,
            agent: args.agent ?? "build"
          });
          return JSON.stringify(result, null, 2);
        }
      }),
      skill_improve_description: tool({
        description: "Call OpenCode to generate an improved skill description based on eval results. Uses the current description and failure patterns to propose a better one.",
        args: {
          skillPath: tool.schema.string().describe("Path to the skill directory"),
          evalResultsPath: tool.schema.string().describe("Path to JSON file with eval results (output of skill_eval)"),
          historyPath: tool.schema.string().optional().describe("Path to JSON file with previous improvement history"),
          model: tool.schema.string().optional().describe("Model ID in provider/model format"),
          logDir: tool.schema.string().optional().describe("Directory to save improvement transcripts"),
          iteration: tool.schema.number().optional().describe("Current iteration number")
        },
        async execute(args) {
          const { readFileSync } = await import("fs");
          const meta = parseSkillMd(args.skillPath);
          const evalResults = JSON.parse(readFileSync(args.evalResultsPath, "utf-8"));
          const history = args.historyPath ? JSON.parse(readFileSync(args.historyPath, "utf-8")) : [];
          const newDescription = await improveDescription({
            skillName: meta.name,
            skillContent: meta.fullContent,
            currentDescription: meta.description,
            evalResults,
            history,
            model: args.model,
            logDir: args.logDir ?? null,
            iteration: args.iteration ?? null
          });
          return JSON.stringify({ description: newDescription, charCount: newDescription.length });
        }
      }),
      skill_optimize_loop: tool({
        description: "Run the full description optimization loop: split eval set into train/test, evaluate, improve description based on failures, repeat. Returns the best description found. This can take several minutes.",
        args: {
          evalSetPath: tool.schema.string().describe("Path to eval_set.json"),
          skillPath: tool.schema.string().describe("Path to the skill directory"),
          descriptionOverride: tool.schema.string().optional().describe("Starting description override"),
          maxIterations: tool.schema.number().optional().describe("Max optimization iterations (default: 5)"),
          numWorkers: tool.schema.number().optional().describe("Parallel workers (default: 10)"),
          timeout: tool.schema.number().optional().describe("Timeout per query in seconds (default: 30)"),
          runsPerQuery: tool.schema.number().optional().describe("Runs per query (default: 3)"),
          triggerThreshold: tool.schema.number().optional().describe("Trigger rate threshold (default: 0.5)"),
          triggerOnly: tool.schema.boolean().optional().describe("Stop each eval run as soon as the synthetic skill is triggered and ignore later workflow failures (default: true)"),
          holdout: tool.schema.number().optional().describe("Test set holdout fraction (default: 0.4)"),
          model: tool.schema.string().optional().describe("Model ID in provider/model format"),
          agent: tool.schema.string().optional().describe("OpenCode agent for trigger eval runs (default: build)"),
          liveReportPath: tool.schema.string().optional().describe("Path to write live HTML report"),
          logDir: tool.schema.string().optional().describe("Directory for improvement transcripts")
        },
        async execute(args) {
          const { readFileSync } = await import("fs");
          const evalSet = JSON.parse(readFileSync(args.evalSetPath, "utf-8"));
          const meta = parseSkillMd(args.skillPath);
          const projectRoot = instance.projectRoot();
          await assertNoInstalledSkillConflict(meta.name, projectRoot, instance.enumerate);
          const result = await runLoop({
            evalSet,
            skillPath: args.skillPath,
            descriptionOverride: normalizeDescriptionOverride(args.descriptionOverride) ?? null,
            numWorkers: args.numWorkers ?? 10,
            timeout: args.timeout ?? 30,
            maxIterations: args.maxIterations ?? 5,
            runsPerQuery: args.runsPerQuery ?? 3,
            triggerThreshold: args.triggerThreshold ?? 0.5,
            triggerOnly: args.triggerOnly ?? true,
            holdout: args.holdout ?? 0.4,
            model: args.model,
            agent: args.agent ?? "build",
            verbose: true,
            liveReportPath: args.liveReportPath ?? null,
            logDir: args.logDir ?? null
          });
          return JSON.stringify(result, null, 2);
        }
      }),
      skill_aggregate_benchmark: tool({
        description: "Aggregate grading.json files from benchmark run directories into summary statistics. Produces benchmark.json with pass rates, timing, and token usage per configuration.",
        args: {
          benchmarkDir: tool.schema.string().describe("Path to the benchmark directory (containing eval-N/ subdirectories)"),
          skillName: tool.schema.string().optional().describe("Skill name for the report header"),
          skillPath: tool.schema.string().optional().describe("Path to the skill directory"),
          outputPath: tool.schema.string().optional().describe("Path to write benchmark.json (default: <benchmarkDir>/benchmark.json)"),
          markdownPath: tool.schema.string().optional().describe("Path to write benchmark.md (default: <benchmarkDir>/benchmark.md)")
        },
        async execute(args) {
          const { writeFileSync } = await import("fs");
          const benchmark = generateBenchmark(args.benchmarkDir, args.skillName ?? "", args.skillPath ?? "");
          const jsonPath = args.outputPath ?? join10(args.benchmarkDir, "benchmark.json");
          writeFileSync(jsonPath, JSON.stringify(benchmark, null, 2));
          const mdPath = args.markdownPath ?? join10(args.benchmarkDir, "benchmark.md");
          writeFileSync(mdPath, generateMarkdown(benchmark));
          return JSON.stringify({
            benchmarkJsonPath: jsonPath,
            benchmarkMdPath: mdPath,
            summary: benchmark.run_summary
          }, null, 2);
        }
      }),
      skill_generate_report: tool({
        description: "Generate a self-contained HTML report showing description optimization results per iteration with pass/fail indicators for each eval query.",
        args: {
          dataPath: tool.schema.string().describe("Path to the optimization results JSON (output of skill_optimize_loop)"),
          outputPath: tool.schema.string().describe("Path to write the HTML report"),
          skillName: tool.schema.string().optional().describe("Skill name for the report title"),
          autoRefresh: tool.schema.boolean().optional().describe("Add auto-refresh meta tag (default: false)")
        },
        async execute(args) {
          const { readFileSync, writeFileSync } = await import("fs");
          const data = JSON.parse(readFileSync(args.dataPath, "utf-8"));
          const html = generateHtml(data, {
            autoRefresh: args.autoRefresh ?? false,
            skillName: args.skillName ?? ""
          });
          writeFileSync(args.outputPath, html);
          return JSON.stringify({ reportPath: args.outputPath });
        }
      }),
      skill_serve_review: tool({
        description: "Start an HTTP server that serves the eval review viewer. Regenerates HTML on each page load so refreshing picks up new outputs. Opens the browser automatically.",
        args: {
          workspace: tool.schema.string().describe("Path to the workspace directory containing eval results"),
          port: tool.schema.number().optional().describe("Server port (default: 3117)"),
          skillName: tool.schema.string().optional().describe("Skill name for the viewer header"),
          previousWorkspace: tool.schema.string().optional().describe("Path to previous iteration's workspace (for showing old outputs and feedback)"),
          benchmarkPath: tool.schema.string().optional().describe("Path to benchmark.json for the Benchmark tab"),
          allowPartial: tool.schema.boolean().optional().describe("Allow launching review even if with_skill/baseline run pairs are incomplete (default: false)")
        },
        async execute(args) {
          const prep = prepareReviewLaunch(args);
          const existing = instance.servers.get(args.workspace);
          if (existing) {
            await existing.stop();
            instance.servers.delete(args.workspace);
          }
          const templatePath = join10(TEMPLATES_DIR, "viewer.html");
          const { server, url, feedbackPath, stop } = await serveReview({
            workspace: args.workspace,
            port: args.port ?? 3117,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: prep.benchmarkPath,
            templatePath,
            openBrowser: true
          });
          instance.servers.set(args.workspace, { stop, url });
          return JSON.stringify({
            url,
            feedbackPath,
            benchmarkPath: prep.benchmarkPath,
            workflowGuard: {
              strictMode: prep.strictMode,
              allowPartial: prep.allowPartial,
              evalCount: prep.validation.evalCount,
              foundConfigs: prep.validation.foundConfigs,
              issues: prep.validation.issues
            },
            message: `Eval viewer running at ${url}. Press Ctrl+C or call skill_stop_review to stop.`
          });
        }
      }),
      skill_stop_review: tool({
        description: "Stop a running eval review viewer server.",
        args: {
          workspace: tool.schema.string().optional().describe("Workspace path of the server to stop (stops all if omitted)")
        },
        async execute(args) {
          if (args.workspace) {
            const srv = instance.servers.get(args.workspace);
            if (srv) {
              await srv.stop();
              instance.servers.delete(args.workspace);
              return JSON.stringify({ stopped: args.workspace });
            }
            return JSON.stringify({ error: "No server running for this workspace" });
          }
          const stopped = [];
          for (const [ws, srv] of instance.servers) {
            await srv.stop();
            stopped.push(ws);
          }
          instance.servers.clear();
          return JSON.stringify({ stopped });
        }
      }),
      skill_export_static_review: tool({
        description: "Generate a standalone HTML eval review file (no server needed). Use in headless environments or for sharing.",
        args: {
          workspace: tool.schema.string().describe("Path to the workspace directory"),
          outputPath: tool.schema.string().describe("Path to write the HTML file"),
          skillName: tool.schema.string().optional().describe("Skill name for the viewer header"),
          previousWorkspace: tool.schema.string().optional().describe("Path to previous iteration's workspace"),
          benchmarkPath: tool.schema.string().optional().describe("Path to benchmark.json"),
          allowPartial: tool.schema.boolean().optional().describe("Allow exporting review even if with_skill/baseline run pairs are incomplete (default: false)")
        },
        async execute(args) {
          const prep = prepareReviewLaunch(args);
          const templatePath = join10(TEMPLATES_DIR, "viewer.html");
          const outPath = exportStaticReview({
            workspace: args.workspace,
            outputPath: args.outputPath,
            skillName: args.skillName,
            previousWorkspace: args.previousWorkspace ?? null,
            benchmarkPath: prep.benchmarkPath,
            templatePath
          });
          return JSON.stringify({
            outputPath: outPath,
            benchmarkPath: prep.benchmarkPath,
            workflowGuard: {
              strictMode: prep.strictMode,
              allowPartial: prep.allowPartial,
              evalCount: prep.validation.evalCount,
              foundConfigs: prep.validation.foundConfigs,
              issues: prep.validation.issues
            },
            message: `Static viewer written to ${outPath}`
          });
        }
      })
    }
  };
}
var SkillCreatorPlugin = async () => {
  await initialize();
  return buildPluginTools(createPluginInstance());
};
var v2Plugin = {
  id: "opencode-skill-creator",
  async setup(ctx) {
    await initialize();
    const locationDirectory = ctx.location?.directory;
    if (typeof locationDirectory !== "string" || !locationDirectory) {
      throw new Error("opencode-skill-creator: setup() received no ctx.location.directory; cannot resolve the project root for skill evaluation.");
    }
    const instance = createPluginInstance({
      projectRoot: () => findProjectRoot(locationDirectory),
      enumerate: createV2SkillEnumerator(ctx)
    });
    const tools = buildPluginTools(instance).tool;
    await ctx.tool.transform((editor) => {
      for (const [name, definition] of Object.entries(tools)) {
        editor.add({
          name,
          description: definition.description,
          input: deriveJsonSchema(definition.args),
          async execute(raw) {
            return {
              content: await definition.execute(raw, {})
            };
          }
        });
      }
    });
    return async () => {
      const servers = [...instance.servers.values()];
      instance.servers.clear();
      await Promise.all(servers.map(async (server) => {
        try {
          await server.stop();
        } catch {}
      }));
    };
  }
};
var skill_creator_default = {
  ...v2Plugin,
  async server() {
    return SkillCreatorPlugin({});
  }
};

// runtime-entry.ts
var runtime_entry_default = skill_creator_default;
export {
  runtime_entry_default as default
};
