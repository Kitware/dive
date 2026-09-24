/**
 * The Query page parks its state here when it is left (e.g. to open a
 * result in the viewer) and takes it back when next shown, so the
 * exemplar, results, marks, edits in progress and grid position resume
 * where the user left off. Only one session is held.
 */
import { shallowRef } from 'vue';
import type { ReviewService } from 'dive-common/use/useReview';
import type { QueryPageState } from './useQueryPage';
import type { ItemChips, SearchChips } from './useSearchChips';
import type { SearchReview } from './useSearchReview';

/** Grid position the results grid restores on return. */
export interface ResultsGridMemory {
  page: number;
  hideReviewed: boolean;
  /** Showing the 3D descriptor-space view instead of the grid. */
  space: boolean;
  /** How many top results the 3D view places. */
  spaceCount: number;
}

export interface QuerySession {
  page: QueryPageState;
  review: ReviewService;
  searchReview: SearchReview;
  searchChips: SearchChips;
  textChips: ItemChips;
  view: 'query' | 'datasets';
  results: ResultsGridMemory;
  textPage: number;
}

/** Shallow: the services must not be deeply unwrapped. */
const held = shallowRef<QuerySession | null>(null);

export function holdQuerySession(session: QuerySession) {
  held.value = session;
}

/** The held session, if any; the caller now owns it. */
export function takeQuerySession(): QuerySession | null {
  const session = held.value;
  held.value = null;
  return session;
}
