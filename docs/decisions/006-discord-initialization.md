# ADR-006: Create initial configuration through an authorized Discord command

## Status
Accepted. Extends ADR-003 with first creation of the base file; existing base files remain locally edited.

## Context
First installation previously required either staying on environment settings or copying/editing the JSON template. The user requested friendly Discord setup while retaining the copy workflow. The bot needs host credentials and safe project/CLI locations before it can connect; these cannot be discovered or accepted as arbitrary chat paths under the existing security model.

## Decision
Add `/ai init` with optional default project/profile autocomplete. Require the configured guild and both user/admin allowlists at the transport and management boundaries, including init autocomplete. Start from valid local environment configuration when the base file is absent. Create a complete validated version-1 base file with selected approved defaults, retain admin overrides and publish the new runtime generation under the existing config/dispatch gate.

When no base file exists and environment project settings are missing or invalid, allow the bot to connect in setup mode. Use the canonical config directory as a host-defined `default` candidate; block workers and pause saved schedules until initialization. The no-option command opens a modal asking for approved project/profile aliases, explicitly labels the startup-folder candidate, and validates authorization and configuration revision again at submission. Credentials, allowlists and provider settings still require valid host configuration. Invalid existing files or overrides remain errors. Explicit slash options retain direct creation. This lets first installation finish in Discord without requiring a JSON file or a usable environment project path merely to connect.

Publish by linking a fully written private temporary file to the destination, which fails if it already exists. Preserve manual copies exactly, including concurrent copies. If creation fails, retain the active snapshot and return fixed guidance with the manual template-copy alternative. Do not send generated JSON, raw filesystem errors or host paths to Discord.

An existing file returns setup guidance without changes. Copied files continue to take precedence over legacy environment settings and use `/ai-admin reload` after edits. Persisted default overrides take precedence; conflicting init selections require changing those overrides first, avoiding a two-file transaction or silently ignored user choices. First-install setup cannot run during an active worker. Captured schedules and sessions retain their existing identities.

## Alternatives considered
- Accept project paths/executable settings from chat: expands host filesystem authority and contradicts current repository boundaries.
- Copy the example unchanged: its placeholder directories/installations are invalid on a fresh host and would overwrite usable local settings.
- Overwrite existing config or flatten/delete overrides: risks operator edits and loses established override semantics, including profile deletion tombstones.

## Consequences
Operators configure the minimum `.env` settings and log in locally, then can finish configuration in Discord. Copying/editing the template remains equally supported. Admin management stays opt-in. Reregister commands once for the new subcommand; configuration activation needs no restart. Live private-reply/setup screenshots remain part of release verification.
