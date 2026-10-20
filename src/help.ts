import { AttachmentBuilder } from 'discord.js';

export const helpTopics = ['all', 'ai', 'admin'] as const;
export type HelpTopic = typeof helpTopics[number];

export interface CommandHelp {
  command: string;
  description: string;
  usage: string;
  example: string;
  notes?: string;
}

function sessionHelp(): CommandHelp[] {
  const prefix = '/ai';
  const selection = ' [profile:NAME | provider:CLI model:MODEL project:NAME] [effort:LEVEL]';
  const exampleSelection = ' profile:review';
  return [
    { command: prefix + ' init', description: 'Admin: finish first-install configuration from locally approved projects and providers.',
      usage: prefix + ' init [project:NAME] [profile:NAME]', example: prefix + ' init project:default profile:codex',
      notes: 'Requires both admin and ordinary user allowlists. Creates ai.config.json without overwriting an existing file. With no options, opens a form asking for default project/profile aliases; explicit options use autocomplete and save directly. When local project settings are missing or invalid, the bot starts in setup mode with default pointing to its startup folder; tasks remain blocked until init completes. Configure other host paths and CLI logins locally. Rejected while the worker is busy.' },
    { command: prefix + ' run', description: 'Send a task to the local AI worker, or save it to run later.',
      usage: prefix + ' run prompt:TEXT' + selection + ' [at:DATE | after:DURATION | every:DURATION] [queue:true]',
      example: prefix + ' run' + exampleSelection + ' prompt:Review the code and suggest improvements',
      notes: 'prompt is required (1–4,000 characters). Omit timing to run now; choose at most one timing option. Every task gets a job ID and its private reply updates every 30 seconds with state, elapsed time and the latest activity the provider reports (Claude reports only when finished). Up to AI_MAX_WORKERS jobs (host setting, default 1) run at once, but only one per project folder (a folder inside another counts as the same). Immediate tasks are rejected when no worker is free or the project already has a job, unless queue:true is set: queued jobs start automatically, in order within each project (at most 5 waiting). Queued jobs are cancelled, not replayed, if the bot restarts.' },
    { command: prefix + ' new', description: 'Start a fresh conversation and discard the selected session’s saved result.',
      usage: prefix + ' new' + selection, example: prefix + ' new' + exampleSelection,
      notes: 'Project files, CLI history on disk and schedules remain. Rejected while the worker is busy.' },
    { command: prefix + ' status', description: 'Show worker state, selected model, session and completed turns.',
      usage: prefix + ' status' + selection, example: prefix + ' status' + exampleSelection,
      notes: 'Codex also shows account quota/context when available. Claude/Gemini quota are unavailable; use context for Claude context usage. Works while a task is running.' },
    { command: prefix + ' context', description: 'Show context window usage for the selected session.',
      usage: prefix + ' context' + selection, example: prefix + ' context provider:claude',
      notes: 'Claude shows the model, tokens used/remaining and a cache/input/output breakdown of the latest request, read from local Claude Code session history without a model turn. Codex shows its context estimate and account quota. Gemini is unavailable. Chat text is never shown. Works while a task is running.' },
    { command: prefix + ' clear', description: 'Clear the selected conversation and saved result; same reset behavior as new.',
      usage: prefix + ' clear' + selection, example: prefix + ' clear' + exampleSelection,
      notes: 'Does not delete project files, cancel schedules or stop a task. Rejected while the worker is busy.' },
    { command: prefix + ' result', description: 'Retrieve the latest result for the selected session, or any saved job by ID.',
      usage: prefix + ' result' + selection + ' [id:JOB_ID]', example: prefix + ' result id:1a2b3c4d',
      notes: 'With id, shows that job (from /ai jobs or autocomplete) including after restart; running and queued jobs show progress instead. Only the job owner can open it. Without id: reuse the task profile alone, or the same provider/model/project. Profiles bind project/provider/model. Legacy profiles without project use your current project. A conflicting project override is rejected. The latest per-session result is kept in memory until reset/restart; job history keeps results on disk.' },
    { command: prefix + ' stop', description: 'Stop a running job or withdraw a queued job, including a scheduled run you own.',
      usage: prefix + ' stop [id:JOB_ID]', example: prefix + ' stop id:1a2b3c4d',
      notes: 'Omit id to stop your running job; if several run, choose one by id. Owners can stop their own jobs; admins can stop any job. Terminates the CLI process tree and frees the worker after it has exited. Files it already changed are not reverted (see /ai changes), and the conversation resumes from the last completed turn. Queued jobs are removed without running. Finished or unknown jobs are reported, never affected. A stopped repeating schedule runs again at its next interval. Works while the worker is busy.' },
    { command: prefix + ' jobs', description: 'List your recent jobs with ID, state, duration, project and prompt preview.',
      usage: prefix + ' jobs', example: prefix + ' jobs',
      notes: 'Shows your 10 newest jobs in this server, including each schedule run separately and queue positions. Admins also see other users’ running/queued job IDs (without prompts) so they can stop them. History survives restart and keeps the newest 200 jobs. Works while the worker is busy.' },
    { command: prefix + ' changes', description: 'Show the files and Git diff that one job changed, formatted for mobile.',
      usage: prefix + ' changes id:JOB_ID [page:N]', example: prefix + ' changes id:1a2b3c4d page:2',
      notes: 'Read-only: never resets, checks out, commits or edits files. Lists added/modified/deleted files with line counts and shows the diff in pages; the full diff is attached when it does not fit. Only changes made while the job ran are shown, not earlier uncommitted edits or other jobs. Edits made by hand during the job cannot be told apart. Requires a Git repository and write permissions. Likely secrets and files such as .env or keys are hidden. Only the job owner can view it.' },
    { command: prefix + ' models', description: 'List allowed models, the selected default and matching profiles for a provider.',
      usage: prefix + ' models [provider:CLI | profile:NAME]', example: prefix + ' models provider:codex',
      notes: 'Omit both options for personal defaults, otherwise the default profile. Loads model choices from the provider CLI without a prompt; while busy, shows saved choices. Autocomplete uses the last loaded catalog. npm run models -- --provider codex --discover inspects the same CLI catalog from a terminal.' },
    { command: prefix + ' config', description: 'Choose your provider, model and effort from private lists and save them for future prompts.',
      usage: prefix + ' config [provider:CLI] [model:MODEL] [effort:LEVEL]',
      example: prefix + ' config provider:codex model:gpt-5.3-codex effort:high',
      notes: 'Omit options to open dropdowns. Model lists load from the selected provider CLI and combine with local choices. Use Refresh models from CLI to reload after installation/login changes. Lists paginate and choices persist per server/channel/user and provider across restart. Use model:__default__ or effort:default for CLI defaults. Explicit prompt options override saved settings for that request. Named profiles keep their own model. Effort uses CLI capabilities when available. Existing schedules retain their captured settings.' },
    { command: prefix + ' schedules', description: 'List your saved jobs, next run, state and any pause reason in this channel.',
      usage: prefix + ' schedules', example: prefix + ' schedules',
      notes: 'Lists all your projects/providers, including disabled targets. Works while the worker is busy.' },
    { command: prefix + ' cancel', description: 'Delete a saved schedule belonging to you in this channel.',
      usage: prefix + ' cancel id:SCHEDULE_ID', example: prefix + ' cancel id:12345678-1234-1234-1234-123456789abc',
      notes: 'Copy the id from schedules. An already running task finishes; cancellation stops future scheduled runs. Use stop to end the running task. Past runs stay in /ai jobs.' },
    { command: prefix + ' projects', description: 'List enabled project aliases and your current project.',
      usage: prefix + ' projects', example: prefix + ' projects',
      notes: 'Shows aliases only. If your previous selection is unavailable, use project to select an enabled alias.' },
    { command: prefix + ' project', description: 'Switch your current project for this server/channel/user.',
      usage: prefix + ' project name:PROJECT', example: prefix + ' project name:web',
      notes: 'The preference applies to /ai commands. A project option on a session command overrides only that request. Switching preserves other sessions and is rejected while busy.' },
  ];
}

export const commandHelp: readonly CommandHelp[] = [
  { command: '/help', description: 'Explain every bot command, its options and an example.',
    usage: '/help [topic:all | ai | admin]', example: '/help topic:ai',
    notes: 'Omit topic for the full guide. Long guides are attached as help.txt. Replies are private.' },
  ...sessionHelp(),
  { command: '/ai-admin status', description: 'Inspect runtime config source/revision, defaults and available profiles/projects/providers.',
    usage: '/ai-admin status', example: '/ai-admin status', notes: 'Does not expose local paths. Available while the worker is busy.' },
  { command: '/ai-admin reload', description: 'Validate and reload the local base config together with saved overrides.',
    usage: '/ai-admin reload', example: '/ai-admin reload',
    notes: 'Use after local catalog edits. Invalid configuration keeps the previous generation active. Overrides take precedence over base values.' },
  { command: '/ai-admin provider-add', description: 'Register and enable a supported CLI provider from Discord.',
    usage: '/ai-admin provider-add provider:CLI [models:MODEL1,MODEL2] [default-model:MODEL]',
    example: '/ai-admin provider-add provider:claude models:sonnet,opus default-model:sonnet',
    notes: 'Supports codex, claude and gemini. Requires completed /ai init. The CLI must already be installed and logged in on the bot host. Claude uses PATH or local CLAUDE_EXECUTABLE; Gemini requires local GEMINI_CLI_SCRIPT. Executable paths and credentials cannot be supplied through Discord. Admins may approve comma-separated model IDs; default-model is also approved. Omitted default-model uses the host model setting, otherwise CLI default. Use /ai models provider:CLI to discover additional models, then profile-add. Saves to ai.config.json and activates immediately. Existing providers are preserved; use provider to enable them. Defaults and saved schedules keep their targets.' },
  { command: '/ai-admin profile-add', description: 'Create a new named project/provider/model profile without replacing an existing one.',
    usage: '/ai-admin profile-add name:PROFILE provider:CLI project:PROJECT [model:MODEL] [effort:LEVEL]',
    example: '/ai-admin profile-add name:review provider:claude project:web model:sonnet effort:high',
    notes: 'Choose a registered provider and an allowed model from autocomplete. Omit model or effort for the CLI default; effort must be supported by the chosen provider/model (see autocomplete). Profile names follow project alias rules. Duplicate names are rejected; use profile-set to replace an existing profile. Saves immediately and survives restart. Select it with /ai run profile:PROFILE prompt:YOUR_TASK; use defaults to make it the shared default.' },
  { command: '/ai-admin profile-set', description: 'Create a profile or replace its project/provider/model target.',
    usage: '/ai-admin profile-set name:PROFILE provider:CLI project:PROJECT [model:MODEL] [effort:LEVEL]',
    example: '/ai-admin profile-set name:review provider:claude project:web model:sonnet effort:high',
    notes: 'provider must be locally installed; model must be allowed locally. Omit model or effort for the CLI default, including when replacing an existing profile. An effort option on a prompt overrides the profile effort for that request.' },
  { command: '/ai-admin profile-delete', description: 'Delete a profile after choosing another default if necessary.',
    usage: '/ai-admin profile-delete name:PROFILE', example: '/ai-admin profile-delete name:review',
    notes: 'Cannot delete the default profile. Jobs that captured this profile are paused and must be cancelled/recreated.' },
  { command: '/ai-admin project', description: 'Enable or disable an existing locally configured project alias.',
    usage: '/ai-admin project project:PROJECT enabled:true|false', example: '/ai-admin project project:web enabled:false',
    notes: 'Change the default project before disabling it. Disabled selections require choosing another project; affected jobs pause.' },
  { command: '/ai-admin project-add', description: 'Register or create a project folder using an absolute host directory or a configured root alias.',
    usage: '/ai-admin project-add name:PROJECT [directory:ABSOLUTE_PATH | root:ROOT] [create:true|false]',
    example: '/ai-admin project-add name:my-app directory:ABSOLUTE_PATH create:true',
    notes: 'Choose exactly one of directory or root. directory accepts an absolute path on the bot host, with no preconfigured root needed; the alias can differ from the folder name. Root aliases come from optional local projectRoots, with name also naming an immediate child folder. Alias rules: lowercase letter first; lowercase letters, digits, underscores and hyphens; maximum 32 characters. Omit create to register an existing folder; create:true creates missing parent folders and the target, and never replaces an existing target. Target symbolic links/junctions are rejected; existing parent paths are canonicalized. Requires completed /ai init. Saves to ai.config.json and activates immediately; defaults, current selections and existing schedules stay unchanged. Use /ai project name:PROJECT afterward. Rejected while busy. Replies expose aliases only.' },
  { command: '/ai-admin provider', description: 'Enable or disable a locally configured CLI provider.',
    usage: '/ai-admin provider provider:CLI enabled:true|false', example: '/ai-admin provider provider:claude enabled:true',
    notes: 'Change the default profile before disabling its provider. Affected jobs pause; restoring a target does not automatically resume paused jobs.' },
  { command: '/ai-admin defaults', description: 'Set the shared default project and/or profile.',
    usage: '/ai-admin defaults [project:PROJECT] [profile:PROFILE]', example: '/ai-admin defaults project:web profile:review',
    notes: 'Supply at least one option and select enabled/usable targets. Saved jobs retain their original targets. Users who selected a project keep that preference. Changing the default profile replaces personal /ai config choices saved earlier: everyone uses the new default until they choose again with /ai config.' },
  { command: '/ai-admin shutdown', description: 'Power off the computer running the bot after a delay (Windows hosts only).',
    usage: '/ai-admin shutdown confirm:true [delay:MINUTES]', example: '/ai-admin shutdown confirm:true delay:5',
    notes: 'delay is 1–60 minutes (default 1). Rejected while a worker runs. The bot goes offline with the computer; scheduled jobs that start before then are interrupted and marked failed after restart. Use shutdown-cancel within the delay to abort.' },
  { command: '/ai-admin shutdown-cancel', description: 'Abort a host shutdown scheduled with /ai-admin shutdown.',
    usage: '/ai-admin shutdown-cancel', example: '/ai-admin shutdown-cancel',
    notes: 'Available while the worker is busy. Reports when no shutdown is scheduled.' },
];

const selectionGuide = [
  'Use /ai config to save personal provider/model/effort defaults for this server/channel/user. Omitted prompt options use saved choices; explicit options override one request. When an admin changes the default profile, earlier personal choices stop applying until saved again. Model lists are approved locally. CLI defaults: model:__default__, effort:default.',
  'Selection: /ai uses personal settings when configured, otherwise the shared default profile. Choose profile OR provider, never both.',
  'An explicit provider uses your saved model for that provider, otherwise its configured default. Add model:MODEL to choose an allowed model for one request. Model alone uses your selected provider, otherwise the default profile\'s provider. Choose a profile OR provider/model options.',
  'Use /ai models to list choices and model autocomplete to select. Use the same provider/model for status, result, new and clear. Effort applies to each turn and keeps model history. Providers: codex, claude, gemini (only enabled providers can run).',
  'A profile binds project/provider/model: use profile alone for run, status, result, new and clear. Omitted model means CLI default. Legacy profiles without project use your current project. Conflicting project overrides are rejected; choose provider/model/project directly to change targets. Equivalent directory/provider/model selections share conversation history. Use project aliases from autocomplete, never filesystem paths.',
  'Example aliases web/review and model sonnet must be configured before use; replace them with your autocomplete selections.',
].join('\n');

function timingGuide(): string {
  const prefix = '/ai';
  return [
    'Scheduling options (run only):',
    '- at: future YYYY-MM-DD HH:mm in Bangkok (UTC+07:00), or ISO date with Z/offset.',
    '- after: run once after a delay, e.g. 10m or 1h 30m.',
    '- every: repeat at an interval, e.g. 2 hours; minimum 1 minute. Durations are at most 365 days.',
    '- Choose exactly one timing option for a scheduled job; omit all for immediate execution.',
    'Examples:',
    prefix + ' run project:web prompt:Review the code after:10m',
    prefix + ' run project:web prompt:Check for regressions every:2 hours',
    prefix + ' run project:web prompt:Review the code at:YYYY-MM-DD HH:mm',
    'Saved jobs capture their targets. Changed/disabled targets can pause jobs; cancel and recreate them. Cancel does not stop an active task; use ' + prefix + ' stop.',
  ].join('\n');
}

export function helpText(topic: HelpTopic = 'all'): string {
  const entries = commandHelp.filter(entry => topic === 'all'
    || (topic === 'admin' ? entry.command.startsWith('/ai-admin ') || entry.command === '/ai init' : entry.command.startsWith('/' + topic + ' ')));
  const sections = [
    'Bot command guide — ' + topic,
    'All replies are private with mentions disabled. Access requires the configured server and user allowlist. Workers (AI_MAX_WORKERS, default 1) are shared across all users/projects/providers, with one job per project folder at a time.',
    'Help is available while the worker is busy. Syntax: UPPERCASE values are placeholders; [brackets] indicate optional options and | means choose one alternative.',
  ];
  if (topic !== 'admin') sections.push(selectionGuide);
  if (topic === 'all' || topic === 'admin') sections.push(
    'Admin commands require membership in both ADMIN_USER_IDS and the ordinary user allowlist. Blank ADMIN_USER_IDS disables management. All admin changes except status are rejected while a worker runs.',
    'Admin edits persist as local overrides, except project-add and provider-add which save to ai.config.json. project-add accepts an absolute host directory or an optional locally configured root alias. provider-add registers a supported CLI and optional approved model IDs. Executables and the optional projectRoots catalog remain local settings.');
  sections.push(...entries.map(entry => [entry.command, entry.description, 'Usage: ' + entry.usage,
    'Example: ' + entry.example, ...(entry.notes ? [entry.notes] : [])].join('\n')));
  if (topic === 'all' || topic === 'ai') sections.push(timingGuide());
  return sections.join('\n\n');
}

export function helpReply(topic: string | null = null) {
  if (topic !== null && !helpTopics.some(value => value === topic)) throw new Error('AI_HELP_TOPIC');
  const selected = (topic ?? 'all') as HelpTopic;
  const text = helpText(selected);
  const content = text.length <= 1900 ? text : [
    'Bot command help — ' + selected + '. Read descriptions, options and examples in **help.txt**.',
    '',
    '**/ai**: run — send/schedule/queue a task; status — worker/session information; context — context window usage; result — latest answer or a job by id; jobs — your job history; stop — end or unqueue a job; changes — files a job changed; new / clear — reset the selected conversation.',
    '**/ai**: models — list model choices; projects — list aliases; project — switch your current project; schedules — list your jobs; cancel — remove a schedule (use stop for a running task).',
    '**/ai init** (admins only): finish first-install configuration with optional default project/profile choices; existing files are preserved.',
    '**/ai-admin** (admins only): status — inspect config; reload — reload local files; provider-add — register a CLI; profile-add / profile-set / profile-delete — manage profiles; project / provider — enable or disable; project-add — register/create a project folder; defaults — change shared defaults; shutdown / shutdown-cancel — power off the host or abort.',
    '',
    'Quick start: /ai run prompt:Review the code → /ai jobs → /ai result id:JOB_ID → /ai changes id:JOB_ID',
    'Use autocomplete for configured aliases and models. Choose profile OR provider/model on /ai; omit selection for the default profile. Replies are private.',
    'For a focused guide: /help topic:ai | /help topic:admin',
  ].join('\n');
  return { content, files: text.length <= 1900 ? []
    : [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'help.txt' })], allowedMentions: { parse: [] as [] } };
}
