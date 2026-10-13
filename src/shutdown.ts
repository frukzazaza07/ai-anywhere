interface ShutdownOptions {
  stopScheduler: () => Promise<void>;
  stopWorker: () => Promise<void>;
  closeClient: () => Promise<void> | void;
}

/** Close admission synchronously, drain accepted work, then disconnect Discord. */
export class Shutdown {
  private completion?: Promise<void>;
  private closing = false;
  private readonly handlers = new Set<Promise<unknown>>();

  constructor(private readonly options: ShutdownOptions) {}

  get stopping(): boolean { return this.closing; }

  track(handler: Promise<unknown>): void {
    this.handlers.add(handler);
    void handler.then(() => this.handlers.delete(handler), () => this.handlers.delete(handler));
  }

  stop(): Promise<void> {
    if (this.completion) return this.completion;
    this.closing = true;
    this.completion = this.drain();
    return this.completion;
  }

  private async drain(): Promise<void> {
    // Both methods close their own admission before their first await.
    const outcomes = await Promise.allSettled([this.options.stopScheduler(), this.options.stopWorker()]);
    await Promise.allSettled([...this.handlers]);
    await this.options.closeClient();
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('AI_SHUTDOWN_SAVE');
  }
}
