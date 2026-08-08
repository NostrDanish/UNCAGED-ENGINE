/**
 * Browser API polyfills for older engines.
 *
 * AbortSignal.any() creates an AbortSignal that aborts when any of the
 * provided signals aborts — used to combine search cancellation with
 * per-relay timeouts.
 *
 * AbortSignal.timeout() aborts after a number of milliseconds.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
 */

if (!AbortSignal.any) {
  AbortSignal.any = function (signals: AbortSignal[]): AbortSignal {
    if (signals.length === 0) {
      return new AbortController().signal;
    }

    if (signals.length === 1) {
      return signals[0];
    }

    for (const signal of signals) {
      if (signal.aborted) {
        const controller = new AbortController();
        controller.abort(signal.reason);
        return controller.signal;
      }
    }

    const controller = new AbortController();

    const onAbort = (event: Event) => {
      const target = event.target as AbortSignal;
      controller.abort(target.reason);
    };

    for (const signal of signals) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    controller.signal.addEventListener('abort', () => {
      for (const signal of signals) {
        signal.removeEventListener('abort', onAbort);
      }
    }, { once: true });

    return controller.signal;
  };
}

if (!AbortSignal.timeout) {
  AbortSignal.timeout = function (milliseconds: number): AbortSignal {
    const controller = new AbortController();

    setTimeout(() => {
      controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    }, milliseconds);

    return controller.signal;
  };
}
