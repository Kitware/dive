import { holdQuerySession, QuerySession, takeQuerySession } from './querySession';

describe('querySession', () => {
  it('hands the held session to exactly one taker', () => {
    const session = { view: 'query', results: { page: 2, hideReviewed: true }, textPage: 0 } as QuerySession;
    expect(takeQuerySession()).toBeNull();
    holdQuerySession(session);
    expect(takeQuerySession()).toBe(session);
    expect(takeQuerySession()).toBeNull();
  });
});
