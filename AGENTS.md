# Repository Guidelines

## Project Structure & Module Organization

This repository is a personal Discord bot that runs local AI coding CLIs (Codex, Claude Code, and Gemini CLI). TypeScript source lives in `src/`: `bot.ts` handles Discord interactions, `config.ts` validates environment settings, `register.ts` registers slash commands, `runner.ts` launches Codex, `agent-runner.ts` adapts the additional CLIs, and `providers.ts` defines provider selection. `projects.ts` validates local project aliases and tracks preferences; `project-sessions.ts` isolates project directories while enforcing one shared worker. Keep session management separate from Discord transport. Tests belong in `test/`. Feature specs, task plans, and architecture decisions document provider behavior. Compiled output goes to `dist/` and is ignored; edit source files instead. There is no separate asset directory.

## Build, Test, and Development Commands

Use Node.js 24.17.0 or newer.

- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: run the bot directly through `tsx`.
- `npm run build`: compile strict TypeScript to `dist/`.
- `npm start`: run the compiled bot.
- `npm test`: run the offline Node.js test suite.
- `npm run register`: publish command definitions to the configured Discord server; rerun when command names or options change.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, and semicolons, matching existing files. Use camelCase for functions and variables, PascalCase for types, and lowercase descriptive filenames. This project uses ES modules and NodeNext resolution: write relative TypeScript imports with `.js` extensions. Preserve strict typing and avoid `any`. No formatter or linter is configured; the TypeScript build is the static check.

## Testing Guidelines

Use `node:test` with `node:assert/strict`; name files `test/*.test.ts` and describe behavior in test titles. Mock the CLI with temporary scripts instead of calling models or Discord. Cover session resets, isolation, busy handling, stdin delivery, credential filtering, failures, and timeouts when changing those behaviors. Always clean up temporary files and restore environment variables. Run `npm run build` and `npm test` before submitting. No coverage threshold is configured.

## Commit & Pull Request Guidelines

There are no commits yet, so no historical message convention exists. Use concise imperative subjects, such as `Add Codex session commands`. Describe behavior changes, validation results, and related issues in pull requests. Include Discord screenshots for visible interaction changes and document required registration or configuration steps.

## Security & Configuration

Keep `.env` and tokens untracked; use `.env.example` for placeholders. Preserve guild/user authorization, ephemeral replies, disabled mentions, and one active worker across all providers and projects. Launch CLIs without a shell and send prompts through stdin. Worker commands must select configured project aliases and never accept arbitrary paths or executable overrides. Explicit design exception: authorized admins may register/create a project using an absolute host directory through `/ai-admin project-add`; persist the canonical directory locally and expose aliases only in replies. Optional root aliases remain locally configured. Isolate sessions by canonical project directory/provider/model as well as user/channel/guild. Scheduled jobs capture project alias and directory; never redirect legacy jobs to a new default. Claude and Gemini adapters use restricted file tools; never enable permission bypass or shell tools without an explicit design change.
