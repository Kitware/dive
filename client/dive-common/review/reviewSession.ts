import type { ReviewService } from 'dive-common/use/useReview';

/**
 * The review page hands its state here when it is left and takes it back
 * when it is next shown, so navigating away and back resumes the same
 * datasets and page (Results when any are loaded, otherwise Datasets).
 * Unsaved edits are resolved (saved or discarded) before the leave
 * completes. Only one session is held; a fresh start (new datasets
 * picked in the library) replaces it.
 */
export interface ReviewSession {
  review: ReviewService;
  view: 'results' | 'datasets';
  page: number;
  /** Key of the datasets the session was started with, see `sessionKey`. */
  datasetKey: string;
}

let held: ReviewSession | null = null;

export function sessionKey(ids: readonly string[]): string {
  return [...ids].sort().join('\n');
}

export function holdReviewSession(session: ReviewSession) {
  held = session;
}

/** The held session, if any; the caller now owns it. */
export function takeReviewSession(): ReviewSession | null {
  const session = held;
  held = null;
  return session;
}

/**
 * Whether a held session should be resumed for a page opened with
 * `initialIds`: always when the page is opened plainly, or when the same
 * datasets are asked for again. A held session that still has pending edits
 * (e.g. after a hard refresh path that could not prompt) is also resumed so
 * those edits are not dropped by a new library selection.
 */
export function shouldResume(session: ReviewSession, initialIds: readonly string[]): boolean {
  if (initialIds.length === 0) return true;
  if (session.review.pendingCount.value > 0) return true;
  return session.datasetKey === sessionKey(initialIds);
}
