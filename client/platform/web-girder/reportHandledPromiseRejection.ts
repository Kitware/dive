/* eslint-disable import/prefer-default-export, import/no-extraneous-dependencies -- single-purpose helper; @sentry/browser is a @sentry/vue peer */
import * as Sentry from '@sentry/browser';

function normalizeError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === 'string') {
    return new Error(reason);
  }
  try {
    return new Error(JSON.stringify(reason));
  } catch {
    return new Error('Unknown error');
  }
}

/**
 * For intentional fire-and-forget async: log to the console and send to Sentry
 * when the SDK is initialized (production builds on viame.kitware.com, etc.).
 */
export function reportHandledPromiseRejection(context: string, reason: unknown): void {
  const err = normalizeError(reason);
  console.error(`[DIVE] ${context}`, err);
  try {
    const client = Sentry.getCurrentHub().getClient();
    if (client) {
      Sentry.captureException(err, { tags: { context } });
    }
  } catch {
    /* Sentry not available */
  }
}
