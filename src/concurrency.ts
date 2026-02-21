/**
 * Semaphore-based concurrency control for parallel operations.
 *
 * Provides {@link mapWithConcurrency}, a `Promise.all`-like helper that caps the
 * number of in-flight promises at any given time. Result order always matches
 * the input order regardless of completion order.
 */

/**
 * A counting semaphore that limits the number of concurrent operations.
 *
 * When the maximum number of permits is reached, further {@link acquire} calls
 * will wait in a FIFO queue until a permit is freed via {@link release}.
 */
class Semaphore {
    /** Queue of callers waiting for a permit. */
    private queue: (() => void)[] = [];
    /** Number of permits currently held. */
    private active = 0;

    /**
     * @param max - Maximum number of concurrent permits.
     */
    constructor(private readonly max: number) {}

    /**
     * Acquires a permit. Resolves immediately if one is available,
     * otherwise waits until a permit is released.
     */
    acquire(): Promise<void> {
        if (this.active < this.max) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => this.queue.push(resolve));
    }

    /**
     * Releases a permit. If callers are waiting in the queue, the next one
     * is resolved immediately (the active count stays the same).
     */
    release(): void {
        const next = this.queue.shift();
        if (next) {
            // Pass the permit directly to the next waiter (active count unchanged)
            next();
        } else {
            this.active--;
        }
    }
}

/**
 * Maps items through an async function with optional concurrency limiting.
 *
 * Behaves like `Promise.all(items.map(fn))` but ensures at most `maxConcurrency`
 * calls to `fn` are in flight at any time. If `maxConcurrency` is `undefined`
 * or greater than or equal to `items.length`, falls back to plain `Promise.all`.
 *
 * Results are always returned in the same order as the input items.
 *
 * @typeParam T - Input item type.
 * @typeParam R - Return type of the async mapper function.
 * @param items - The items to process.
 * @param fn - Async function called for each item with its index.
 * @param maxConcurrency - Optional cap on the number of concurrent `fn` calls.
 * @returns Array of results in the same order as `items`.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    maxConcurrency?: number,
): Promise<R[]> {
    // No limit needed — use plain Promise.all for maximum throughput
    if (maxConcurrency === undefined || maxConcurrency >= items.length) {
        return Promise.all(items.map((item, i) => fn(item, i)));
    }

    const semaphore = new Semaphore(maxConcurrency);
    return Promise.all(
        items.map(async (item, i) => {
            await semaphore.acquire();
            try {
                return await fn(item, i);
            } finally {
                semaphore.release();
            }
        }),
    );
}
