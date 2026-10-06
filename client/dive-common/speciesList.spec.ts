import { describe, expect, it } from 'vitest';

import declareSpeciesTypes from './speciesList';

describe('declareSpeciesTypes', () => {
  const existing = {
    Sebastes: { color: '#ff0000' },
    'retired species': { color: '#00ff00' },
  };

  it('declares a species with an empty entry so it renders in the ordinal palette', () => {
    expect(declareSpeciesTypes({}, ['Sebastes melanops'], false))
      .toEqual({ 'Sebastes melanops': {} });
  });

  it('makes an Overwrite import the whole declaration, keeping styles it names', () => {
    expect(declareSpeciesTypes(existing, ['Sebastes', 'Sebastes flavidus'], false)).toEqual({
      Sebastes: { color: '#ff0000' },
      'Sebastes flavidus': {},
    });
  });

  it('adds only what is missing on an additive import', () => {
    expect(declareSpeciesTypes(existing, ['Sebastes', 'Sebastes flavidus'], true)).toEqual({
      Sebastes: { color: '#ff0000' },
      'retired species': { color: '#00ff00' },
      'Sebastes flavidus': {},
    });
  });

  it('does not mutate the styling it was given', () => {
    const before = JSON.parse(JSON.stringify(existing));
    declareSpeciesTypes(existing, ['Sebastes flavidus'], false);
    expect(existing).toEqual(before);
  });
});
