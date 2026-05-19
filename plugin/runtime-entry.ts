import SkillCreatorPlugin from "./skill-creator"

// Runtime-only wrapper: keep the published OpenCode entrypoint to a single
// default export while skill-creator.ts keeps named exports for tests.
export default SkillCreatorPlugin
