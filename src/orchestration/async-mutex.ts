export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(critical: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await critical();
    } finally {
      release();
    }
  }
}
