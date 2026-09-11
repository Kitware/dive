import {
  describe, expect, it, vi,
} from 'vitest';
import { ref } from 'vue';
import type { ReviewService } from 'dive-common/use/useReview';
import {
  clearReviewSession, holdReviewSession, peekReviewSession, sessionKey, shouldResume, takeReviewSession,
  useReviewSessionHeld,
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
  it('disposes private state when an account session is cleared', () => {
    const held = session(['private']);
    held.review.dispose = vi.fn();
    holdReviewSession(held);
    clearReviewSession();
    expect(held.review.dispose).toHaveBeenCalledOnce();
    expect(peekReviewSession()).toBeNull();
    clearReviewSession();
    expect(held.review.dispose).toHaveBeenCalledOnce();
  });

  it('is handed over once', () => {
    expect(takeReviewSession()).toBeNull();
    const held = session(['a']);
    holdReviewSession(held);
    expect(takeReviewSession()).toBe(held);
    expect(takeReviewSession()).toBeNull();
  });

  it('can be peeked without taking ownership', () => {
    expect(peekReviewSession()).toBeNull();
    const heldFlag = useReviewSessionHeld();
    expect(heldFlag.value).toBe(false);
    const held = session(['a']);
    holdReviewSession(held);
    expect(peekReviewSession()).toBe(held);
    expect(heldFlag.value).toBe(true);
    expect(takeReviewSession()).toBe(held);
    expect(peekReviewSession()).toBeNull();
    expect(heldFlag.value).toBe(false);
  });

  it('resumes for a plain visit, the same selection, or unsaved edits', () => {
    expect(shouldResume(session(['a', 'b']), [])).toBe(true);
    expect(shouldResume(session(['a', 'b']), ['b', 'a'])).toBe(true);
    expect(shouldResume(session(['a', 'b']), ['c'])).toBe(false);
    expect(shouldResume(session(['a', 'b'], 2), ['c'])).toBe(true);
  });
});
