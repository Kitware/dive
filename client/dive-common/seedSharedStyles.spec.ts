import seedSharedStyles from './seedSharedStyles';

const source = { sourceDatasetId: 'ds1', sourceDatasetName: 'Dataset 1' };

describe('seedSharedStyles', () => {
  it('adds unseen styles stamped with their source and keeps existing shared choices', () => {
    const { next, changed } = seedSharedStyles(
      { fish: { color: 'blue' } },
      { fish: { color: 'red' }, shark: { color: 'grey' } },
      source,
    );
    expect(changed).toBe(true);
    expect(next).toEqual({
      fish: { color: 'blue' },
      shark: { color: 'grey', ...source },
    });
  });

  it('leaves a styleless species declaration out of the shared store', () => {
    const { next, changed } = seedSharedStyles(
      {},
      { Sebastes: {}, 'Sebastes melanops': {}, tuna: { color: 'silver' } },
      source,
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ tuna: { color: 'silver', ...source } });
  });

  it('reports no change when nothing is worth seeding', () => {
    const into = { fish: { color: 'blue' } };
    const { next, changed } = seedSharedStyles(into, { fish: { color: 'red' }, Sebastes: {} }, source);
    expect(changed).toBe(false);
    expect(next).toEqual(into);
  });
});
