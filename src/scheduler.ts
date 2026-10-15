import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { taskErrorMessage } from './results.js';
import { cliDefaultModel, isModelName, isProviderId, validateSelection, type ProviderConfig, type ProviderSelection } from './providers.js';
import { isProjectName, selectProject, type ProjectConfig, type ProjectSelection } from './projects.js';
import { type RuntimeConfig } from './runtime-config.js';
import { validateEffort, type Effort } from './effort.js';
import { profileProject, type SelectedProfile } from './selection.js';

export interface Timing { nextRun: number; intervalMs?: number }
export interface ScheduleInput { at?: string | null; after?: string | null; every?: string | null }

export function durationMs(value: string): number {
  const text = value.trim().toLowerCase();
  const units: Record<string, number> = {
    s: 1000, second: 1000, seconds: 1000,
    m: 60000, minute: 60000, minutes: 60000,
    h: 3600000, hour: 3600000, hours: 3600000,
    d: 86400000, day: 86400000, days: 86400000,
    w: 604800000, week: 604800000, weeks: 604800000,
  };
  const pattern = /\s*(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|[smhdw])\s*/gy;
  let position = 0;
  let total = 0;
  while (position < text.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(text);
    if (!match) throw new Error('Use a duration such as 10m, 2 hours or 1h 30m.');
    total += Number(match[1]) * units[match[2]!]!;
    position = pattern.lastIndex;
  }
  if (!Number.isSafeInteger(total) || total <= 0 || total > 365 * 86400000) {
    throw new Error('Duration must be positive and no longer than 365 days.');
  }
  return total;
}

export function scheduledDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
  if (!match) throw new Error('Use YYYY-MM-DD HH:mm (Bangkok time) or an ISO date with Z/+07:00.');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part ?? 0));
  const local = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  const date = new Date(local);
  if (year! < 1970 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new Error('Invalid calendar date or time.');
  }
  const zone = match[7] ?? '+07:00';
  let offset = 0;
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw new Error('Invalid timezone offset.');
    offset = (hours * 60 + minutes) * 60000 * (zone[0] === '+' ? 1 : -1);
  }
  return local - offset;
}

export function parseSchedule(input: ScheduleInput, now = Date.now()): Timing | undefined {
  const supplied = [input.at, input.after, input.every].filter(value => value != null);
  if (!supplied.length) return undefined;
  if (supplied.length !== 1) throw new Error('Choose only one of at, after or every.');
  if (input.at != null) {
    const nextRun = scheduledDate(input.at);
    if (nextRun <= now) throw new Error('Scheduled date must be in the future.');
    return { nextRun };
  }
  const intervalMs = durationMs(input.every ?? input.after!);
  if (input.every != null && intervalMs < 60000) throw new Error('Repeating intervals must be at least 1 minute.');
  return { nextRun: now + intervalMs, ...(input.every != null ? { intervalMs } : {}) };
}

export interface ScheduledJob extends Timing {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  prompt: string;
  workdir: string;
  sandbox: string;
  provider?: ProviderSelection['provider'];
  model?: string;
  effort?: Effort;
  project?: string;
  profile?: string;
  profileProject?: string;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  runs: number;
  lastOutcome?: string;
}
interface SchedulerOptions {
  file: string;
  workdir: string;
  sandbox: string;
  guildId: string;
  allowedUsers: ReadonlySet<string>;
  busy: () => boolean;
  // Each dispatch is a separate job; the schedule ID and run number keep runs apart in history.
  run: (key: string, prompt: string, selection: ProviderSelection, project?: string, schedule?: { id: string; run: number }) => Promise<string>;
  providers?: ProviderConfig;
  projects?: ProjectConfig;
  runtime?: RuntimeConfig;
  now?: () => number;
}
export function scheduleKey(job: Pick<ScheduledJob, 'guildId' | 'channelId' | 'userId'>): string {
  return [job.guildId, job.channelId, job.userId].join(':');
}
function validJob(value: unknown): value is ScheduledJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as ScheduledJob;
  try { validateEffort(job.provider ?? 'codex', job.model, job.effort); } catch { return false; }
  return typeof job.id === 'string' && /^[0-9a-f-]{36}$/.test(job.id)
    && [job.guildId, job.channelId, job.userId].every(id => typeof id === 'string' && /^\d{17,20}$/.test(id))
    && typeof job.prompt === 'string' && !!job.prompt.trim() && job.prompt.length <= 4000
    && typeof job.workdir === 'string' && ['read-only', 'workspace-write'].includes(job.sandbox)
    && (job.provider === undefined || isProviderId(job.provider))
    && (job.model === undefined || isModelName(job.model))
    && (job.project === undefined || isProjectName(job.project))
    && (job.profile === undefined || isProjectName(job.profile))
    && (job.profileProject === undefined || (isProjectName(job.profileProject) && job.profile !== undefined))
    && Number.isSafeInteger(job.nextRun) && job.nextRun > 0
    && (job.intervalMs === undefined || (Number.isSafeInteger(job.intervalMs) && job.intervalMs >= 60000 && job.intervalMs <= 365 * 86400000))
    && ['pending', 'running', 'completed', 'failed', 'paused'].includes(job.state)
    && Number.isSafeInteger(job.runs) && job.runs >= 0
    && (job.lastOutcome === undefined || typeof job.lastOutcome === 'string');
}

export class CodexScheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private writing: Promise<void> = Promise.resolve();
  private ticking = false;
  private closing = false;
  private activeTick?: Promise<void>;
  private pauseDirty = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? Date.now;
    options.runtime?.onChange(() => this.refreshConfig());
  }
  private get projects(): ProjectConfig | undefined { return this.options.runtime?.value.projects ?? this.options.projects; }
  private get providers(): ProviderConfig | undefined { return this.options.runtime?.value.providers ?? this.options.providers; }

  async load(): Promise<void> {
    let text: string;
    try { text = await readFile(this.options.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const stored: unknown = JSON.parse(text);
    if (!Array.isArray(stored) || stored.length > 500 || !stored.every(validJob)
      || new Set(stored.map(job => job.id)).size !== stored.length) throw new Error('Invalid schedule storage.');
    for (const job of stored) {
      // Legacy jobs are bound by their saved directory, never by the new default project.
      if (job.project === undefined && this.projects) job.project = this.projectFor(job)?.project;
      if (job.state === 'running') {
        job.lastOutcome = 'Interrupted by bot restart; previous run was not replayed.';
        job.state = job.intervalMs ? 'pending' : 'failed';
        if (job.intervalMs) this.advance(job);
      }
      if ((job.state === 'pending' || job.state === 'paused') && !this.authorized(job)) {
        job.state = 'paused';
        job.lastOutcome = this.pauseReason(job);
      }
      this.jobs.set(job.id, job);
    }
    await this.save();
  }

  private projectFor(job: ScheduledJob): ProjectSelection | undefined {
    const config = this.projects;
    if (!config) return job.project === undefined
      ? { project: 'default', workdir: this.options.workdir } : undefined;
    try {
      if (job.project !== undefined) return selectProject(config, job.project);
      if (config.directories.get(config.defaultProject) === job.workdir) return selectProject(config);
      const alias = [...config.directories].find(([, directory]) => directory === job.workdir)?.[0];
      return alias ? selectProject(config, alias) : undefined;
    } catch { return undefined; }
  }

  private authorized(job: ScheduledJob): boolean {
    return this.pauseReason(job) === '';
  }
  private pauseReason(job: ScheduledJob): string {
    let reason = '';
    if (this.options.runtime?.value.source === 'setup') reason = 'initial setup required';
    else if (job.guildId !== this.options.guildId || !this.options.allowedUsers.has(job.userId)) reason = 'owner or guild authorization changed';
    else if (job.workdir !== this.projectFor(job)?.workdir) reason = 'project disabled, removed or directory changed';
    else if (job.sandbox !== this.options.sandbox) reason = 'permissions changed';
    else {
      const selected = { provider: job.provider ?? 'codex', model: job.model, ...(job.effort ? { effort: job.effort } : {}) };
      const p = job.profile ? this.options.runtime?.value.profiles.get(job.profile) : undefined;
      if (job.profile && (!p || p.provider !== selected.provider || p.model !== selected.model)) reason = 'profile deleted or provider/model changed';
      else if (p && (job.profileProject !== undefined ? p.project !== job.profileProject
        : p.project !== undefined && p.project !== job.project)) reason = 'profile project changed';
      else {
        try {
          if (this.providers) validateSelection(this.providers, selected);
          else if (selected.provider !== 'codex' || selected.model !== undefined) throw new Error();
        } catch { reason = 'provider disabled or model no longer allowed'; }
      }
    }
    return reason ? 'Paused: ' + reason + '. Cancel and recreate.' : '';
  }
  async refreshConfig(): Promise<void> {
    let changed = false;
    for (const job of this.jobs.values()) {
      if (job.state !== 'pending' && job.state !== 'running') continue;
      const reason = this.pauseReason(job);
      if (reason) { job.state = 'paused'; job.lastOutcome = reason; changed = true; }
    }
    this.pauseDirty ||= changed;
    if (this.pauseDirty) { await this.save(); this.pauseDirty = false; }
  }
  private advance(job: ScheduledJob): void {
    if (job.intervalMs) job.nextRun += Math.max(1, Math.floor((this.now() - job.nextRun) / job.intervalMs) + 1) * job.intervalMs;
  }
  private save(): Promise<void> {
    const text = JSON.stringify([...this.jobs.values()], null, 2) + '\n';
    const save = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.options.file), { recursive: true });
      const temporary = this.options.file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.options.file);
      } finally { await rm(temporary, { force: true }); }
    });
    this.writing = save;
    return save;
  }

  async add(owner: Pick<ScheduledJob, 'guildId' | 'channelId' | 'userId'>, prompt: string, timing: Timing,
    selection: SelectedProfile = { provider: 'codex', model: this.providers?.models.codex },
    project?: string, profile?: string): Promise<ScheduledJob> {
    if (this.closing) throw new Error('AI_SHUTTING_DOWN');
    if (this.options.runtime?.value.source === 'setup') throw new Error('AI_SETUP_REQUIRED');
    profile ??= selection.profile;
    const boundProject = selection.project ?? (profile ? this.options.runtime?.value.profiles.get(profile)?.project : undefined);
    const target = profileProject({ ...selection, project: boundProject }, project);
    const selectedProject = this.projects ? selectProject(this.projects, target) : undefined;
    if (target !== undefined && !selectedProject) throw new Error('AI_PROJECT_UNAVAILABLE');
    const job: ScheduledJob = { ...owner, ...timing, prompt, id: randomUUID(),
      ...selection, profile, ...(boundProject ? { profileProject: boundProject } : {}),
      project: selectedProject?.project, workdir: selectedProject?.workdir ?? this.options.workdir,
      sandbox: this.options.sandbox, state: 'pending', runs: 0 };
    if (!validJob(job) || !this.authorized(job) || job.nextRun <= this.now()) throw new Error('Invalid schedule.');
    if (this.jobs.size >= 500 || this.list(scheduleKey(job)).length >= 50) throw new Error('Schedule limit reached. Cancel old schedules first.');
    this.jobs.set(job.id, job);
    try { await this.save(); }
    catch (error) { this.jobs.delete(job.id); throw error; }
    return { ...job };
  }
  list(key: string): ScheduledJob[] {
    return [...this.jobs.values()].filter(job => scheduleKey(job) === key).map(job => ({ ...job }));
  }
  async cancel(key: string, id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || scheduleKey(job) !== key) return false;
    this.jobs.delete(id);
    try { await this.save(); }
    catch (error) { this.jobs.set(id, job); throw error; }
    return true;
  }
  start(): void {
    if (this.closing) return;
    if (!this.timer) this.timer = setInterval(() => {
      void this.tick().catch(() => console.error('Unable to persist or dispatch schedules.'));
    }, 1000);
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined; }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.stop();
    // A dispatch may be saving its claim or finishing a task. Drain it before the final save.
    // A transient dispatch save failure should not prevent a final durable flush.
    await this.activeTick?.catch(() => {});
    await this.save();
  }

  tick(): Promise<void> {
    if (this.closing || this.ticking || this.options.busy() || this.options.runtime?.updating) return Promise.resolve();
    this.ticking = true;
    const tick = this.dispatch();
    this.activeTick = tick;
    void tick.then(() => { if (this.activeTick === tick) this.activeTick = undefined; },
      () => { if (this.activeTick === tick) this.activeTick = undefined; });
    return tick;
  }

  private async dispatch(): Promise<void> {
    try {
      const prepare = async () => {
        if (this.closing || this.options.busy()) return;
        if (this.pauseDirty) await this.refreshConfig();
        const job = [...this.jobs.values()].filter(item => item.state === 'pending' && item.nextRun <= this.now())
          .sort((a, b) => a.nextRun - b.nextRun)[0];
        if (!job) return;
        if (!this.authorized(job)) {
          job.state = 'paused'; job.lastOutcome = this.pauseReason(job);
          await this.save(); return;
        }
        job.state = 'running';
        try { await this.save(); }
        catch (error) { job.state = 'pending'; throw error; }
        if (this.jobs.get(job.id) !== job) return;
        if (this.closing || this.options.busy()) { job.state = 'pending'; await this.save(); return; }
        // Release the config gate after the session synchronously claims the shared worker.
        const result = (async () => this.options.run(scheduleKey(job), job.prompt,
          { provider: job.provider ?? 'codex', model: job.model, ...(job.effort ? { effort: job.effort } : {}) }, job.project,
          { id: job.id, run: job.runs + 1 }))();
        return { job, result };
      };
      const started = this.options.runtime ? await this.options.runtime.exclusive(prepare) : await prepare();
      if (!started) return;
      const { job } = started;
      let outcome: string;
      let state: ScheduledJob['state'];
      try {
        await started.result;
        outcome = (job.profile ? 'Completed. Read the latest result with /ai result profile:' + job.profile
          + (job.project && !job.profileProject ? ' project:' + job.project : '') + '.'
          : 'Completed. Read the latest result with /ai result provider:' + (job.provider ?? 'codex')
          + ' model:' + (job.model ?? cliDefaultModel) + (job.effort ? ' effort:' + job.effort : '') + (job.project ? ' project:' + job.project : '') + '.')
          + ' Every run is kept separately in /ai jobs.';
        state = 'completed';
      } catch (error) {
        if (error instanceof Error && error.message === 'CODEX_BUSY') {
          job.state = 'pending';
          await this.save();
          return;
        }
        outcome = taskErrorMessage(error, job.provider ?? 'codex');
        state = 'failed';
      }
      const complete = async () => {
        if (this.jobs.get(job.id) !== job) return;
        job.runs++;
        if (job.state !== 'paused') {
          job.lastOutcome = outcome; job.state = state;
          if (job.intervalMs) { this.advance(job); job.state = 'pending'; }
          const reason = this.pauseReason(job);
          if (job.state === 'pending' && reason) { job.state = 'paused'; job.lastOutcome = reason; }
        }
        await this.save();
      };
      if (this.options.runtime) await this.options.runtime.exclusive(complete);
      else await complete();
    } finally { this.ticking = false; }
  }
}

export function schedulesText(jobs: ScheduledJob[]): string {
  if (!jobs.length) return 'No schedules for this user/channel. Use /ai run with at, after or every.';
  return jobs.map(job => [
    'ID: ' + job.id,
    'State: ' + job.state + ' | Runs: ' + job.runs,
    'Project: ' + (job.project ?? 'legacy directory'),
    ...(job.profile ? ['Profile: ' + job.profile] : []),
    'Provider: ' + (job.provider ?? 'codex') + ' | Model: ' + (job.model ?? 'CLI default') + ' | Effort: ' + (job.effort ?? 'CLI default'),
    'Next: <t:' + Math.floor(job.nextRun / 1000) + ':F>' + (job.intervalMs ? ' | Every ' + job.intervalMs / 1000 + 's' : ' | Once'),
    'Prompt: ' + job.prompt,
    ...(job.lastOutcome ? ['Last outcome: ' + job.lastOutcome] : []),
  ].join('\n')).join('\n\n');
}
