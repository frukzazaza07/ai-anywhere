# Bind profiles to project/provider/model

Users previously needed both a profile and a project to reliably retrieve the
same session. Switching the current project could make a profile's result appear
missing even though its provider/model was unchanged.

Profiles now accept a configured project alias. Every session operation resolves
that binding before consulting current-project preferences. Discord profile-add
and profile-set require the alias. Direct provider/model/project selection stays
available and shares sessions with equivalent profiles by canonical directory,
provider/model and guild/channel/user. Profile names remain selection metadata.

The persisted version-1 schema keeps project optional so upgrades preserve legacy
current-project behavior. Operators bind existing profiles explicitly. An explicit
project matching a binding is accepted for compatibility with existing command
hints; a conflicting alias is rejected to keep profile-only retrieval reliable.
Default profiles must target enabled projects; disabled nondefault targets are
hidden from user autocomplete and rejected at execution.

Schedules retain their captured alias/directory and store the original profile
project binding. Moving or removing it permanently pauses pending jobs, requiring
cancel/recreate. Legacy jobs never follow a changed default or profile to another
project. Results and sessions remain in memory as before.

The command schema needs registration once after upgrade. New profile values
activate immediately through the existing validated runtime configuration gate.
