import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicConfigWrite } from './runtime-config.js';
import { isModelName, isProviderId, providerLabels, type ProviderId } from './providers.js';
import { isEffort, type Effort } from './effort.js';
import { isProjectName } from './projects.js';
import { taskErrorMessage } from './results.js';
import { type ProjectSessions } from './project-sessions.js';
import { type SelectedProfile } from './selection.js';
import { trackChanges, type ChangeTracker, type JobChanges } from './changes.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface JobOwner { guildId: string; channelId: string; userId: string }
export interface JobRecord extends JobOwner {
  id: string;
  source: 'discord' | 'schedule';
  scheduleId?: string;
  scheduleRun?: number;
  prompt: string;
  project: string;
  provider: ProviderId;
  model?: string;
  effort?: Effort;
  profile?: string;
  state: JobState;
  created: number;
  started?: number;
  finished?: number;
  // The answer, or a sanitized failure message; never raw CLI logs.
  result?: string;
  changes?: JobChanges;
}
export interface Requester { guildId: string | null; userId: string; admin?: boolean }

export const jobHistoryLimit = 200;
export const jobQueueLimit = 5;
// Streaming providers that stay silent this long are reported as possibly stalled.
export const stallAfterMs = 10 * 60 * 1000;
const jobStates: readonly JobState[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];
const finalStates: readonly JobState[] = ['completed', 'failed', 'cancelled'];
const snowflake = /^\d{17,20}$/;

export function isJobId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value); }
export function ownerKey(owner: JobOwner): string { return [owner.guildId, owner.channelId, owner.userId].join(':'); }
export function ownerFromKey(key: string): JobOwner {
  const [guildId = '', channelId = '', userId = ''] = key.split(':');
  return { guildId, channelId, userId };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
  return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}

function validChanges(value: unknown): value is JobChanges {
  if (!value || typeof value !== 'object') return false;
  const changes = value as Record<string, unknown>;
  if (changes.available === false) return typeof changes.reason === 'string';
  return changes.available === true && typeof changes.diff === 'string' && typeof changes.truncated === 'boolean'
    && Array.isArray(changes.files) && changes.files.every(file => file && typeof file === 'object'
      && typeof file.path === 'string' && ['added', 'modified', 'deleted', 'changed'].includes(file.status)
      && Number.isSafeInteger(file.added) && Number.isSafeInteger(file.removed));
}

function validRecord(value: unknown): value is JobRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as JobRecord;
  const time = (item: unknown) => item === undefined || (Number.isSafeInteger(item) && (item as number) > 0);
  return isJobId(job.id) && [job.guildId, job.channelId, job.userId].every(id => typeof id === 'string' && snowflake.test(id))
    && (job.source === 'discord' || job.source === 'schedule')
    && (job.scheduleId === undefined || (typeof job.scheduleId === 'string' && /^[0-9a-f-]{36}$/.test(job.scheduleId)))
    && (job.scheduleRun === undefined || (Number.isSafeInteger(job.scheduleRun) && job.scheduleRun > 0))
    && typeof job.prompt === 'string' && job.prompt.length <= 4000 && isProjectName(job.project) && isProviderId(job.provider)
    && (job.model === undefined || isModelName(job.model)) && (job.effort === undefined || isEffort(job.effort))
    && (job.profile === undefined || isProjectName(job.profile)) && jobStates.includes(job.state)
    && time(job.created) && job.created !== undefined && time(job.started) && time(job.finished)
    && (job.result === undefined || (typeof job.result === 'string' && job.result.length <= 2_000_000))
    && (job.changes === undefined || validChanges(job.changes));
}

/** Without results or diffs, which are read from disk on demand. */
function summary(record: JobRecord): JobRecord {
  const { result: _result, changes, ...rest } = record;
  return changes ? { ...rest, changes: changes.available ? { ...changes, diff: '' } : changes } : rest;
}

/**
 * Durable job history: one private JSON file per job, newest `limit` jobs retained.
 * Results and diffs stay on disk; memory holds summaries only.
 */
export class JobHistory {
  private readonly jobs = new Map<string, JobRecord>();
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string, private readonly limit = jobHistoryLimit,
    private readonly write: typeof atomicConfigWrite = atomicConfigWrite, private readonly now: () => number = Date.now) {}

  async load(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const loaded: JobRecord[] = [];
    let skipped = 0;
    for (const name of names) {
      // Remove interrupted atomic writes.
      if (/^[0-9a-f]{8}\.json\.[0-9a-f-]{36}\.tmp$/.test(name)) { await rm(join(this.directory, name), { force: true }); continue; }
      const match = /^([0-9a-f]{8})\.json$/.exec(name);
      if (!match) continue;
      try {
        const record: unknown = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
        if (!validRecord(record) || record.id !== match[1]) throw new Error();
        loaded.push(record);
      } catch { skipped++; }
    }
    if (skipped) console.error(skipped + ' job history file(s) are unreadable and were ignored.');
    for (const record of loaded.sort((a, b) => a.created - b.created)) {
      // Interrupted work is never replayed after restart.
      if (record.state === 'running') {
        Object.assign(record, { state: 'failed', finished: this.now(),
          result: 'Interrupted by bot restart; the job did not finish and was not restarted. Files it already changed are not reverted.' });
        await this.save(record);
      } else if (record.state === 'queued') {
        Object.assign(record, { state: 'cancelled', finished: this.now(),
          result: 'The bot restarted before this queued job started; it did not run. Submit it again if it is still needed.' });
        await this.save(record);
      } else this.jobs.set(record.id, summary(record));
    }
    await this.prune();
  }

  newId(): string {
    let id: string;
    do id = randomBytes(4).toString('hex'); while (this.jobs.has(id));
    return id;
  }

  get(id: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  list(filter: (job: JobRecord) => boolean = () => true): JobRecord[] {
    return [...this.jobs.values()].filter(filter).sort((a, b) => b.created - a.created).map(job => ({ ...job }));
  }

  /** Full record including result and changes. */
  async read(id: string): Promise<JobRecord | undefined> {
    if (!this.jobs.has(id)) return undefined;
    await this.writing.catch(() => {});
    try {
      const record: unknown = JSON.parse(await readFile(join(this.directory, id + '.json'), 'utf8'));
      if (validRecord(record) && record.id === id) return record;
    } catch { /* Fall back to the summary below. */ }
    return this.get(id);
  }

  save(record: JobRecord): Promise<void> {
    this.jobs.set(record.id, summary(record));
    const text = JSON.stringify(record, null, 2) + '\n';
    const operation = this.writing.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.write(join(this.directory, record.id + '.json'), text);
    });
    this.writing = operation;
    return operation;
  }

  /** Drop the oldest finished jobs beyond the retention limit. */
  async prune(): Promise<void> {
    const finished = [...this.jobs.values()].filter(job => finalStates.includes(job.state)).sort((a, b) => a.created - b.created);
    const excess = finished.slice(0, Math.max(0, this.jobs.size - this.limit));
    if (!excess.length) return;
    for (const job of excess) this.jobs.delete(job.id);
    const operation = this.writing.catch(() => {}).then(async () => {
      for (const job of excess) await rm(join(this.directory, job.id + '.json'), { force: true });
    });
    this.writing = operation;
    await operation;
  }

  async flush(): Promise<void> { await this.writing.catch(() => {}); }
}

export interface JobRequest {
  owner: JobOwner;
  prompt: string;
  selection: SelectedProfile;
  project?: string;
  queue?: boolean;
  schedule?: { id: string; run: number };
}
export interface SubmittedJob { job: JobRecord; position: number; result: Promise<string> }
export type StopOutcome = 'stopping' | 'already-stopping' | 'dequeued' | 'finished' | 'denied' | 'not-found' | 'idle';

interface Entry {
  record: JobRecord;
  key: string;
  selection: SelectedProfile;
  controller: AbortController;
  result: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
  phase?: 'preparing' | 'running' | 'recording';
  runningSince?: number;
  activity?: string;
  activityAt?: number;
  outputAt?: number;
}

interface JobManagerOptions {
  history: JobHistory;
  sessions: Pick<ProjectSessions, 'prompt' | 'currentProject' | 'busy' | 'shutdown'>;
  sandbox: 'read-only' | 'workspace-write';
  queueLimit?: number;
  // Returns undefined to skip change tracking (tests, read-only projects).
  tracker?: (workdir: string) => Promise<ChangeTracker | undefined>;
  now?: () => number;
}

/**
 * Every AI task runs as a job: one shared worker, a bounded FIFO queue, durable history,
 * owner/admin stop, progress reporting and per-job Git changes.
 */
export class JobManager {
  private active?: Entry;
  private running?: Promise<void>;
  private readonly queue: Entry[] = [];
  private closing = false;
  private readonly now: () => number;

  constructor(private readonly options: JobManagerOptions) { this.now = options.now ?? Date.now; }

  get busy(): boolean { return this.active !== undefined || this.queue.length > 0 || this.options.sessions.busy; }
  get queueLimit(): number { return this.options.queueLimit ?? jobQueueLimit; }

  /** Claims the worker synchronously, or queues when requested; never awaits before claiming. */
  submit(request: JobRequest): SubmittedJob {
    if (this.closing) throw new Error('AI_SHUTTING_DOWN');
    const key = ownerKey(request.owner);
    const project = this.options.sessions.currentProject(key, request.project, request.selection);
    const busy = this.busy;
    if (busy && !request.queue) throw new Error('CODEX_BUSY');
    if (busy && this.queue.length >= this.queueLimit) throw new Error('AI_QUEUE_FULL');
    const { selection } = request;
    const record: JobRecord = { id: this.options.history.newId(), ...request.owner,
      source: request.schedule ? 'schedule' : 'discord',
      ...(request.schedule ? { scheduleId: request.schedule.id, scheduleRun: request.schedule.run } : {}),
      prompt: request.prompt, project: project.project, provider: selection.provider,
      ...(selection.model !== undefined ? { model: selection.model } : {}),
      ...(selection.effort !== undefined ? { effort: selection.effort } : {}),
      ...(selection.profile !== undefined ? { profile: selection.profile } : {}),
      state: 'queued', created: this.now() };
    let resolve!: (value: string) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<string>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    // Callers may stop listening (for example an expired Discord reply).
    void result.catch(() => {});
    const entry: Entry = { record, key, selection, controller: new AbortController(), result, resolve, reject };
    if (busy) {
      this.queue.push(entry);
      this.persist(record);
      return { job: { ...record }, position: this.queue.length, result };
    }
    this.start(entry);
    return { job: { ...record }, position: 0, result };
  }

  private persist(record: JobRecord): void {
    void this.options.history.save({ ...record }).then(() => this.options.history.prune())
      .catch(() => console.error('Unable to save job history. Check local storage permissions.'));
  }

  private start(entry: Entry): void {
    this.active = entry;
    Object.assign(entry.record, { state: 'running', started: this.now() });
    entry.phase = 'preparing';
    this.persist(entry.record);
    const running = this.execute(entry);
    this.running = running;
  }

  private async execute(entry: Entry): Promise<void> {
    const { record } = entry;
    let tracker: ChangeTracker | undefined;
    let outcome: { value: string } | { error: unknown };
    try {
      const workdir = this.options.sessions.currentProject(entry.key, record.project, entry.selection).workdir;
      if (this.options.sandbox === 'read-only') tracker = { finish: async () => ({ available: false,
        reason: 'The job ran with read-only permissions, so it could not change files.' }) };
      else tracker = await (this.options.tracker ?? trackChanges)(workdir).catch(() => undefined);
      entry.phase = 'running';
      entry.runningSince = this.now();
      const value = await this.options.sessions.prompt(entry.key, record.prompt, entry.selection, record.project, {
        signal: entry.controller.signal,
        onProgress: activity => {
          entry.outputAt = this.now();
          if (activity) { entry.activity = activity; entry.activityAt = entry.outputAt; }
        },
      });
      outcome = { value };
      Object.assign(record, { state: 'completed', result: value });
    } catch (error) {
      outcome = { error };
      const cancelled = error instanceof Error && error.message === 'AI_CANCELLED';
      Object.assign(record, { state: cancelled ? 'cancelled' : 'failed', result: taskErrorMessage(error, record.provider) });
    }
    entry.phase = 'recording';
    if (tracker) record.changes = await tracker.finish().catch(() => ({ available: false as const, reason: 'Unable to record changes.' }));
    record.finished = this.now();
    await this.options.history.save({ ...record }).then(() => this.options.history.prune())
      .catch(() => console.error('Unable to save job history. Check local storage permissions.'));
    // Release the worker and start the next queued job without yielding, so nothing can run in between.
    this.active = undefined;
    this.running = undefined;
    if ('value' in outcome) entry.resolve(outcome.value); else entry.reject(outcome.error);
    this.next();
  }

  private next(): void {
    if (this.active || this.closing) return;
    const entry = this.queue.shift();
    if (entry) this.start(entry);
  }

  private owns(requester: Requester, job: JobOwner): boolean {
    return requester.guildId === job.guildId && requester.userId === job.userId;
  }

  /** Owners stop their own jobs; admins may stop any job. Queued jobs are removed without running. */
  stop(requester: Requester, id?: string | null): { outcome: StopOutcome; job?: JobRecord } {
    let entry: Entry | undefined;
    if (id == null) {
      entry = this.active;
      if (!entry) return { outcome: 'idle' };
    } else {
      entry = this.active?.record.id === id ? this.active : this.queue.find(item => item.record.id === id);
      if (!entry) {
        const past = isJobId(id) ? this.options.history.get(id) : undefined;
        if (!past || (!this.owns(requester, past) && !requester.admin)) return { outcome: 'not-found' };
        return { outcome: 'finished', job: past };
      }
    }
    const job = { ...entry.record };
    if (!this.owns(requester, entry.record) && !requester.admin) return { outcome: 'denied', job };
    if (entry.record.state === 'queued') {
      this.queue.splice(this.queue.indexOf(entry), 1);
      Object.assign(entry.record, { state: 'cancelled', finished: this.now(),
        result: 'Removed from the queue before it started; it did not run.' });
      this.persist(entry.record);
      entry.reject(new Error('AI_QUEUE_CANCELLED'));
      return { outcome: 'dequeued', job: { ...entry.record } };
    }
    if (entry.controller.signal.aborted) return { outcome: 'already-stopping', job };
    entry.controller.abort();
    return { outcome: 'stopping', job };
  }

  /** Close admission, drop queued jobs (they never start), then drain the active job. */
  async shutdown(): Promise<void> {
    this.closing = true;
    for (const entry of this.queue.splice(0)) {
      Object.assign(entry.record, { state: 'cancelled', finished: this.now(),
        result: 'The bot shut down before this queued job started; it did not run.' });
      this.persist(entry.record);
      entry.reject(new Error('AI_SHUTTING_DOWN'));
    }
    await this.running;
    await this.options.sessions.shutdown();
    await this.options.history.flush();
  }

  private live(id: string): Entry | undefined {
    return this.active?.record.id === id ? this.active : this.queue.find(entry => entry.record.id === id);
  }

  private visible(requester: Requester): (job: JobRecord) => boolean {
    return job => this.owns(requester, job);
  }

  /** Progress lines from verified state only: phase, elapsed time and provider-reported activity. */
  progress(id: string): string {
    const entry = this.live(id);
    const job = entry?.record ?? this.options.history.get(id);
    if (!job) return 'Job ' + id + ' was not found.';
    const now = this.now();
    if (!entry || finalStates.includes(job.state)) {
      return 'Job ' + id + ': ' + job.state + (job.started && job.finished ? ' in ' + formatDuration(job.finished - job.started) : '') + '.';
    }
    if (job.state === 'queued') {
      return 'Job ' + id + ': queued · position ' + (this.queue.indexOf(entry) + 1) + ' of ' + this.queue.length
        + ' · waiting ' + formatDuration(now - job.created) + '\nIt starts automatically when the worker is free. Remove it: /ai stop id:' + id;
    }
    const lines = ['Job ' + id + ': running · ' + formatDuration(now - (job.started ?? now)) + ' elapsed'
      + (entry.controller.signal.aborted ? ' · stopping' : '')];
    if (entry.phase === 'preparing') lines.push('Activity: recording the starting Git state');
    else if (entry.phase === 'recording') lines.push('Activity: recording file changes');
    else if (job.provider === 'claude') lines.push('Activity: not reported while running (' + providerLabels.claude + ' reports when it finishes)');
    else {
      lines.push(entry.activity ? 'Activity: ' + entry.activity + ' (' + formatDuration(now - entry.activityAt!) + ' ago)'
        : 'Activity: none reported yet');
      const silentFor = now - (entry.outputAt ?? entry.runningSince ?? now);
      lines.push(entry.outputAt ? 'Last CLI output: ' + formatDuration(now - entry.outputAt) + ' ago' : 'No CLI output yet');
      if (silentFor >= stallAfterMs) lines.push('No CLI output for ' + formatDuration(silentFor) + '; the job may be stalled.');
    }
    lines.push('Stop: /ai stop id:' + id);
    return lines.join('\n');
  }

  /** Header for a finished job reply. */
  outcomeLine(id: string): string {
    const job = this.options.history.get(id);
    if (!job) return 'Job ' + id;
    const duration = job.started && job.finished ? formatDuration(job.finished - job.started) : undefined;
    const verb = job.state === 'completed' ? 'completed' : job.state === 'cancelled' ? 'was stopped' : 'failed';
    return 'Job ' + id + ' ' + verb + (duration ? ' after ' + duration : '') + '.'
      + (job.changes?.available && job.changes.files.length ? ' Changed ' + job.changes.files.length + ' files: /ai changes id:' + id : '');
  }

  /** Running/queued jobs owned by the requester, for /ai status. */
  activeText(requester: Requester): string {
    return [this.active, ...this.queue].filter((entry): entry is Entry => !!entry && this.owns(requester, entry.record))
      .map(entry => this.progress(entry.record.id)).join('\n\n');
  }

  list(requester: Requester, limit = 10): JobRecord[] {
    return this.options.history.list(this.visible(requester)).slice(0, limit).map(job => ({ ...job, ...this.live(job.id)?.record }));
  }

  jobsText(requester: Requester, limit = 10): string {
    const total = this.options.history.list(this.visible(requester)).length;
    const jobs = this.list(requester, limit);
    const now = this.now();
    const lines = jobs.length ? ['Your recent jobs (newest first, ' + jobs.length + ' of ' + total + '):'] : ['You have no saved jobs. Start one with /ai run prompt:….'];
    for (const job of jobs) {
      const duration = job.state === 'queued' ? 'queued #' + (this.queue.findIndex(entry => entry.record.id === job.id) + 1)
        : formatDuration((job.finished ?? now) - (job.started ?? now));
      const prompt = job.prompt.replace(/\s+/g, ' ').replace(/`/g, "'");
      lines.push('`' + job.id + '` ' + job.state + ' · ' + duration + ' · <t:' + Math.floor(job.created / 1000) + ':R>',
        '  ' + job.project + ' · ' + providerLabels[job.provider] + (job.model ? ' ' + job.model : '')
        + (job.scheduleId ? ' · schedule ' + job.scheduleId.slice(0, 8) + ' run ' + job.scheduleRun : '')
        + ' · ' + (prompt.length > 60 ? prompt.slice(0, 57) + '…' : prompt));
    }
    if (requester.admin) {
      const others = [this.active, ...this.queue].filter((entry): entry is Entry => !!entry && !this.owns(requester, entry.record));
      if (others.length) lines.push('', 'Other users\' active jobs (admin):', ...others.map(entry => '`' + entry.record.id + '` '
        + entry.record.state + ' · ' + entry.record.project + ' · ' + providerLabels[entry.record.provider]));
    }
    if (jobs.length) lines.push('', 'Open: /ai result id:ID · Changes: /ai changes id:ID · Stop: /ai stop id:ID');
    return lines.join('\n');
  }

  /** Owner-only full record; running and queued jobs show progress instead of a result. */
  async details(requester: Requester, id: string): Promise<{ job?: JobRecord; text: string }> {
    const known = isJobId(id) ? this.options.history.get(id) : undefined;
    if (!known || !this.owns(requester, known)) return { text: 'Job ' + id + ' was not found for your account in this server. Use /ai jobs to list your jobs.' };
    const live = this.live(id);
    const job = live ? { ...live.record } : await this.options.history.read(id) ?? known;
    const header = ['Job ' + job.id + ' · ' + job.state,
      'Project: ' + job.project + ' · ' + providerLabels[job.provider] + ' · Model: ' + (job.model ?? 'CLI default')
        + ' · Effort: ' + (job.effort ?? 'CLI default') + (job.profile ? ' · Profile: ' + job.profile : ''),
      job.scheduleId ? 'Source: schedule ' + job.scheduleId + ' (run ' + job.scheduleRun + ')' : 'Source: /ai run',
      'Created: <t:' + Math.floor(job.created / 1000) + ':f>' + (job.started && job.finished
        ? ' · Duration: ' + formatDuration(job.finished - job.started) : ''),
      'Prompt: ' + (job.prompt.length > 300 ? job.prompt.slice(0, 297) + '…' : job.prompt)];
    if (live) return { job, text: header.join('\n') + '\n\n' + this.progress(id) };
    if (job.changes?.available && job.changes.files.length) header.push('Changed files: ' + job.changes.files.length + ' · /ai changes id:' + job.id);
    return { job, text: header.join('\n') + '\n\n' + (job.result ?? 'No result was saved.') };
  }

  /** Autocomplete choices: the requester's jobs, plus other active jobs for admins on stop. */
  choices(requester: Requester, query: string, includeActive = false): Array<{ name: string; value: string }> {
    const jobs = this.list(requester, 50);
    if (includeActive && requester.admin) {
      for (const entry of [this.active, ...this.queue]) {
        if (entry && !jobs.some(job => job.id === entry.record.id)) jobs.unshift({ ...entry.record });
      }
    }
    return jobs.filter(job => (!includeActive || !finalStates.includes(job.state))
      && (job.id + ' ' + job.prompt).toLowerCase().includes(query.toLowerCase())).slice(0, 25)
      .map(job => {
        const prompt = job.prompt.replace(/\s+/g, ' ');
        const name = job.id + ' · ' + job.state + ' · ' + job.project + ' · ' + prompt;
        return { name: name.length > 100 ? name.slice(0, 99) + '…' : name, value: job.id };
      });
  }
}
