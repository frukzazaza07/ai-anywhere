# Third-party notices

This project's source is licensed under [MIT](LICENSE). Its dependencies, runtimes and optional CLIs retain their own licenses. Source releases exclude `node_modules/`, `node-24/` and compiled output; `npm ci` installs the locked packages separately. Keep upstream license/NOTICE files when redistributing dependency code or binaries.

## Review recorded on 2026-10-13

The lockfile declares 63 dependency entries: 17 Apache-2.0, 44 MIT, one BSD-2-Clause and one 0BSD. Every entry has license metadata. This is a metadata inventory, not a complete license determination for native/transitive bundled components. The lockfile SHA-256 is `fcb354fbd0cd1e23d5893072ab6fa53fb8bf8409debaf6fc1621d574296b6efc`. Re-run `npm run release:check` and review notices whenever the lockfile changes.

The installed Windows Codex 0.162.1 binary also includes voice runtime notices under `@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex-resources/voice/NOTICE.md`. Its bundled GStreamer/GLib components carry LGPL-2.1 requirements, with additional licenses for libintl, libffi, PCRE2, sljit, Opus and zlib. Microsoft Visual C++ runtime DLLs have separate Microsoft redistribution terms. The upstream package contains associated license texts, source/build manifests and redistribution references. Apache-2.0 package metadata alone does not describe these components. Review the upstream manifests/notices for each platform before distributing Codex binaries; this beta distributes only bot source and a dependency lockfile.

Claude Code and Gemini CLI are optional operator installations and are not bundled in this repository. Their licensing and account terms are separate. Do not include their binaries, credentials or histories in bot release artifacts. Node.js is also an operator prerequisite; retain its distribution notices if bundling it in a future installer.

Ownership of repository contributions, notices for all supported native platform distributions, Git history and final artifacts still require maintainer review before publication. No third-party binaries have been copied into this release candidate.

## Locked npm packages

Repeated names represent nested installations in the lockfile. Optional platform packages are included even when not installed on this host.

| Package | Locked version | Declared SPDX license |
| --- | --- | --- |
| `@discordjs/builders` | 1.14.1 | Apache-2.0 |
| `@discordjs/collection` | 1.5.3 | Apache-2.0 |
| `@discordjs/formatters` | 0.6.2 | Apache-2.0 |
| `@discordjs/rest` | 2.6.3 | Apache-2.0 |
| `@discordjs/collection` | 2.1.1 | Apache-2.0 |
| `@discordjs/util` | 1.2.0 | Apache-2.0 |
| `@discordjs/ws` | 1.2.3 | Apache-2.0 |
| `@discordjs/collection` | 2.1.1 | Apache-2.0 |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT |
| `@esbuild/android-arm` | 0.28.2 | MIT |
| `@esbuild/android-arm64` | 0.28.2 | MIT |
| `@esbuild/android-x64` | 0.28.2 | MIT |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT |
| `@esbuild/darwin-x64` | 0.28.2 | MIT |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT |
| `@esbuild/linux-arm` | 0.28.2 | MIT |
| `@esbuild/linux-arm64` | 0.28.2 | MIT |
| `@esbuild/linux-ia32` | 0.28.2 | MIT |
| `@esbuild/linux-loong64` | 0.28.2 | MIT |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT |
| `@esbuild/linux-s390x` | 0.28.2 | MIT |
| `@esbuild/linux-x64` | 0.28.2 | MIT |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT |
| `@esbuild/sunos-x64` | 0.28.2 | MIT |
| `@esbuild/win32-arm64` | 0.28.2 | MIT |
| `@esbuild/win32-ia32` | 0.28.2 | MIT |
| `@esbuild/win32-x64` | 0.28.2 | MIT |
| `@openai/codex` | 0.162.1 | Apache-2.0 |
| `@openai/codex-darwin-arm64` | 0.162.1-darwin-arm64 | Apache-2.0 |
| `@openai/codex-darwin-x64` | 0.162.1-darwin-x64 | Apache-2.0 |
| `@openai/codex-linux-arm64` | 0.162.1-linux-arm64 | Apache-2.0 |
| `@openai/codex-linux-x64` | 0.162.1-linux-x64 | Apache-2.0 |
| `@openai/codex-win32-arm64` | 0.162.1-win32-arm64 | Apache-2.0 |
| `@openai/codex-win32-x64` | 0.162.1-win32-x64 | Apache-2.0 |
| `@sapphire/async-queue` | 1.5.5 | MIT |
| `@sapphire/shapeshift` | 4.0.0 | MIT |
| `@sapphire/snowflake` | 3.5.5 | MIT |
| `@types/node` | 24.19.2 | MIT |
| `@types/ws` | 8.18.2 | MIT |
| `@vladfrangu/async_event_emitter` | 2.4.7 | MIT |
| `discord-api-types` | 0.38.56 | MIT |
| `discord.js` | 14.27.0 | Apache-2.0 |
| `dotenv` | 17.4.2 | BSD-2-Clause |
| `esbuild` | 0.28.2 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fsevents` | 2.3.3 | MIT |
| `lodash` | 4.18.1 | MIT |
| `lodash.snakecase` | 4.1.1 | MIT |
| `magic-bytes.js` | 1.13.1 | MIT |
| `ts-mixer` | 6.0.4 | MIT |
| `tslib` | 2.8.1 | 0BSD |
| `tsx` | 4.23.15 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `undici` | 6.29.0 | MIT |
| `undici-types` | 7.24.6 | MIT |
| `ws` | 8.22.0 | MIT |
