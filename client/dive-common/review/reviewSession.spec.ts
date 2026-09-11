import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { ReviewService } from 'dive-common/use/useReview';
import {
  holdReviewSession, sessionKey, shouldResume, takeReviewSession,
} from './reviewSession';

function session(datasetIds: string[], pending = 0) {
  return {
    review: { pendingCount: ref(pending) } as unknown as ReviewService,
    view: 'results' as const,
    page: 3,
    datasetKey: sessionKey(datasetIds),
  };
}

describe('review session', () => {
  it('is handed over once', () => {
    expect(takeReviewSession()).toBeNull();
    const held = session(['a']);
    holdReviewSession(held);
    expect(takeReviewSession()).toBe(held);
    expect(takeReviewSession()).toBeNull();
  });

  it('resumes for a plain visit, the same selection, or unsaved edits', () => {
    expect(shouldResume(session(['a', 'b']), [])).toBe(true);
    expect(shouldResume(session(['a', 'b']), ['b', 'a'])).toBe(true);
    expect(shouldResume(session(['a', 'b']), ['c'])).toBe(false);
    expect(shouldResume(session(['a', 'b'], 2), ['c'])).toBe(true);
  });
});
