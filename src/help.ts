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
  const selection = ' [project:NAME] [profile:NAME | provider:CLI]';
  const exampleSelection = ' profile:review project:web';
  return [
    { command: prefix + ' run', description: 'Send a task to the local AI worker, or save it to run later.',
      usage: prefix + ' run prompt:TEXT' + selection + ' [at:DATE | after:DURATION | every:DURATION]',
      example: prefix + ' run' + exampleSelection + ' prompt:Review the code and suggest improvements',
      notes: 'prompt is required (1–4,000 characters). Omit timing to run now; choose at most one timing option. Immediate tasks are rejected while the shared worker is busy.' },
    { command: prefix + ' new', description: 'Start a fresh conversation and discard the selected session’s saved result.',
      usage: prefix + ' new' + selection, example: prefix + ' new' + exampleSelection,
      notes: 'Project files, CLI history on disk and schedules remain. Rejected while the worker is busy.' },
    { command: prefix + ' status', description: 'Show worker state, selected model, session and completed turns.',
      usage: prefix + ' status' + selection, example: prefix + ' status' + exampleSelection,
      notes: 'Codex also shows account quota/context when available. Claude/Gemini quota/context are unavailable. Works while a task is running.' },
    { command: prefix + ' clear', description: 'Clear the selected conversation and saved result; same reset behavior as new.',
      usage: prefix + ' clear' + selection, example: prefix + ' clear' + exampleSelection,
      notes: 'Does not delete project files, cancel schedules or stop a task. Rejected while the worker is busy.' },
    { command: prefix + ' result', description: 'Retrieve the latest result or sanitized failure for the selected session.',
      usage: prefix + ' result' + selection, example: prefix + ' result' + exampleSelection,
      notes: 'Use the same project and profile/provider as your task, including when the original Discord reply expires. Results are private and kept in memory until reset/restart or replaced by a later result.' },
    { command: prefix + ' schedules', description: 'List your saved jobs, next run, state and any pause reason in this channel.',
      usage: prefix + ' schedules', example: prefix + ' schedules',
      notes: 'Lists all your projects/providers, including disabled targets. Works while the worker is busy.' },
    { command: prefix + ' cancel', description: 'Delete a saved schedule belonging to you in this channel.',
      usage: prefix + ' cancel id:SCHEDULE_ID', example: prefix + ' cancel id:12345678-1234-1234-1234-123456789abc',
      notes: 'Copy the id from schedules. An already running task finishes; cancellation stops future scheduled runs.' },
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
  { command: '/ai-admin profile-set', description: 'Create a profile or replace its provider/model pair.',
    usage: '/ai-admin profile-set name:PROFILE provider:CLI [model:MODEL]',
    example: '/ai-admin profile-set name:review provider:claude model:sonnet',
    notes: 'provider must be locally installed; model must be allowed locally. Omit model for CLI default, including when replacing an existing profile.' },
  { command: '/ai-admin profile-delete', description: 'Delete a profile after choosing another default if necessary.',
    usage: '/ai-admin profile-delete name:PROFILE', example: '/ai-admin profile-delete name:review',
    notes: 'Cannot delete the default profile. Jobs that captured this profile are paused and must be cancelled/recreated.' },
  { command: '/ai-admin project', description: 'Enable or disable an existing locally configured project alias.',
    usage: '/ai-admin project project:PROJECT enabled:true|false', example: '/ai-admin project project:web enabled:false',
    notes: 'Change the default project before disabling it. Disabled selections require choosing another project; affected jobs pause.' },
  { command: '/ai-admin provider', description: 'Enable or disable a locally configured CLI provider.',
    usage: '/ai-admin provider provider:CLI enabled:true|false', example: '/ai-admin provider provider:claude enabled:true',
    notes: 'Change the default profile before disabling its provider. Affected jobs pause; restoring a target does not automatically resume paused jobs.' },
  { command: '/ai-admin defaults', description: 'Set the shared default project and/or profile.',
    usage: '/ai-admin defaults [project:PROJECT] [profile:PROFILE]', example: '/ai-admin defaults project:web profile:review',
    notes: 'Supply at least one option and select enabled/usable targets. Saved jobs retain their original targets. Users who selected a project keep that preference.' },
];

const selectionGuide = [
  'Selection: /ai uses the shared default profile when profile/provider is omitted. Choose profile OR provider, never both.',
  'An explicit provider uses its configured default model; use /ai provider:codex to select Codex. Providers: codex, claude, gemini (only enabled providers can run).',
  'A profile binds provider/model; omitted model means CLI default. Equivalent pairs share conversation history. Use project aliases from autocomplete, never filesystem paths.',
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
    'Saved jobs capture their targets. Changed/disabled targets can pause jobs; cancel and recreate them. Cancel does not stop an active task.',
  ].join('\n');
}

export function helpText(topic: HelpTopic = 'all'): string {
  const entries = commandHelp.filter(entry => topic === 'all'
    || (topic === 'admin' ? entry.command.startsWith('/ai-admin ') : entry.command.startsWith('/' + topic + ' ')));
  const sections = [
    'Bot command guide — ' + topic,
    'All replies are private with mentions disabled. Access requires the configured server and user allowlist. One worker is shared across all users/projects/providers.',
    'Help is available while the worker is busy. Syntax: UPPERCASE values are placeholders; [brackets] indicate optional options and | means choose one alternative.',
  ];
  if (topic !== 'admin') sections.push(selectionGuide);
  if (topic === 'all' || topic === 'admin') sections.push(
    'Admin commands require membership in both ADMIN_USER_IDS and the ordinary user allowlist. Blank ADMIN_USER_IDS disables management. All admin changes except status are rejected while a worker runs.',
    'Admin edits persist as local overrides. Adding project aliases/directories, installing executables or changing allowed model catalogs requires editing local config and reload.');
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
    '**/ai**: run — send/schedule a task; status — worker/session information; result — retrieve the latest answer; new / clear — reset the selected conversation and result.',
    '**/ai**: projects — list aliases; project — switch your current project; schedules — list your jobs; cancel — remove a schedule (a running task finishes).',
    '**/ai-admin** (admins only): status — inspect config; reload — reload local files; profile-set / profile-delete — manage profiles; project / provider — enable or disable; defaults — change shared defaults.',
    '',
    'Quick start: /ai run prompt:Review the code → /ai status → /ai result',
    'Use autocomplete for configured aliases. Choose profile OR provider on /ai; omit both for the default profile. Replies are private.',
    'For a focused guide: /help topic:ai | /help topic:admin',
  ].join('\n');
  return { content, files: text.length <= 1900 ? []
    : [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'help.txt' })], allowedMentions: { parse: [] as [] } };
}
