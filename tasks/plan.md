# Implementation plan: Configured project switching

1. Add allowlisted project configuration and selection state; verify directory validation and per-user/channel selection.
2. Add a project session facade around provider sessions, preserving one shared busy guard and isolating paths.
3. Add project snapshot fields and legacy directory-based schedule migration; verify remapping/removal pauses.
4. Register project choices, switch/list commands and route session/schedule work to captured projects.
5. Update operator setup and architecture docs; run build and the full offline suite.

User confirmed switching between configured projects. No dependencies or external registration/model calls are needed. Project aliases and canonical directory snapshots prevent chat paths or preference changes from redirecting saved work.
