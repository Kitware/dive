/// <reference types="jest" />

import RangeList from './rangelist';

/* Only ranges of [begin, end) are valid.
 * A range from 1 to 3, including 3, would be represented:
 * { begin: 1, end: 4, key: 'foo' }
 * OR [1,4)
 */
describe('RangeList', () => {
  it('should add and remove trivial ranges', () => {
    const rlist = new RangeList();
    rlist.add({
      begin: 0,
      end: 1,
      key: 'foo',
    });
    expect(rlist.size()).toBe(1);
    expect(rlist.query(0)).toHaveLength(1);
    expect(rlist.query(1)).toHaveLength(0);
  });

  it('should allow adding multiple ranges at once', () => {
    const rlist = new RangeList();
    const r1 = { begin: 1, end: 2, key: 'foo' };
    const r2 = { begin: 1, end: 3, key: 'baz' };
    const r3 = { begin: 5, end: 10, key: 'bar' };
    rlist.add(r1, r2, r3);
    expect(rlist.size()).toBe(3);
    expect(rlist.query(2)).toHaveLength(1);
    expect(rlist.query(2)).toEqual({ begin: 1, end: 3, key: 'baz' });
  });

  it('should not allow zero-length ranges', () => {
    const rl = new RangeList();
    expect(rl.add({ begin: 100, end: 100, key: 'foo' })).toThrowError();
  });

  it('should not allow backward ranges', () => {
    const rl = new RangeList();
    expect(rl.add({ begin: 100, end: -2, key: 'foo' })).toThrowError();
  });

  it('should allow negative ranges', () => {
    const rl = new RangeList();
    rl.add({ begin: -20, end: -19, key: 'foo' });
    expect(rl.query(-19)).toHaveLength(0);
    expect(rl.query(-20)).toHaveLength(1);
  });
});
