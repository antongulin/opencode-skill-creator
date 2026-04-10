# Contributing to opencode-skill-creator

Thanks for your interest in contributing! This project is based on [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) and adapted for the OpenCode ecosystem.

## Ways to Contribute

- **Bug reports**: Open an issue with a clear description and steps to reproduce
- **Feature requests**: Open an issue describing the use case and proposed solution
- **Pull requests**: Fix a bug, add a feature, or improve documentation
- **Skill examples**: Share skills you've created using this tool (great for learning!)
- **Documentation**: Improve README, add examples, fix typos

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/opencode-skill-creator.git`
3. Install dependencies: `cd plugin && bun install`
4. Create a branch: `git checkout -b my-contribution`

## Development Setup

The project has two components:

- **Skill** (`skill-creator/`): Markdown instructions (SKILL.md + agents + templates). Edit these directly.
- **Plugin** (`plugin/`): TypeScript module. Uses Bun as the runtime.

To test the plugin locally:

1. Build and link the plugin locally
2. Add it to your OpenCode config
3. Restart OpenCode and test your changes

## Pull Request Process

1. Make your changes in a feature branch
2. Include a clear description of what changed and why
3. If fixing a bug, include a test case or steps to reproduce
4. If adding a feature, update relevant documentation
5. Ensure the existing tests pass (if applicable)
6. Open a PR against the `main` branch

## Code Style

- TypeScript for the plugin
- Markdown for the skill
- Follow existing patterns in the codebase
- Keep PRs focused on a single concern

## Reporting Issues

When reporting bugs, please include:

- OpenCode version you're using
- The model you're using with OpenCode
- Steps to reproduce
- Expected behavior
- Actual behavior (including error messages)
- Your operating system

## Questions?

Open a GitHub Discussion or an issue. We're happy to help!

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0, the same license as the project.