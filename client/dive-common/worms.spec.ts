import {
  groupSynonymRemaps, synonymRemapSummary, WormsClient, WormsRecord,
} from './worms';

const taxon = (id: number, name: string, extra = {}): WormsRecord => ({
  AphiaID: id,
  scientificname: name,
  rank: 'Species',
  status: 'accepted',
  valid_AphiaID: id,
  valid_name: name,
  ...extra,
});
const response = (value: unknown, status = 200) => ({
  ok: status < 400, status, json: async () => value,
} as Response);
const signal = () => new AbortController().signal;

describe('synonym remap presentation', () => {
  it('groups remaps by accepted name and summarizes counts', () => {
    const remaps = [
      { original: 'old salmon', accepted: 'salmon' },
      { original: 'Salmo old', accepted: 'salmon' },
      { original: 'old trout', accepted: 'trout' },
    ];
    expect(groupSynonymRemaps(remaps)).toEqual([
      { accepted: 'salmon', originals: ['old salmon', 'Salmo old'] },
      { accepted: 'trout', originals: ['old trout'] },
    ]);
    expect(synonymRemapSummary(remaps)).toBe('3 synonyms will be imported as 2 accepted names.');
    expect(synonymRemapSummary([{ original: 'old', accepted: 'new' }]))
      .toBe('1 synonym will be imported as 1 accepted name.');
  });
});

describe('WoRMS client', () => {
  it('does not bind native browser fetch to the client instance', async () => {
    const browserFetch = vi.fn(function browserFetch(this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(response([taxon(1, 'fish')]));
    });
    vi.stubGlobal('fetch', browserFetch);
    try {
      expect(await new WormsClient().search('fish', 1, signal())).toHaveLength(1);
      expect(browserFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses encoded, paginated marine searches with no credentials and handles empty pages', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([taxon(1, 'fish')]))
      .mockResolvedValueOnce(response(null, 204));
    const client = new WormsClient(fetcher);
    expect(await client.search(' a/b ', 51, signal())).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.marinespecies.org/rest/AphiaRecordsByName/a%2Fb?like=true&marine_only=true&offset=51',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(await client.children(1, 1, signal())).toEqual([]);
    expect(fetcher.mock.calls[1][0]).toContain('AphiaChildrenByAphiaID/1?');
  });

  it('resolves synonyms, deduplicates accepted taxa, and imports complete parent chains', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('AphiaRecordByAphiaID')) return response(taxon(3, 'salmon'));
      return response({
        AphiaID: 1,
        scientificname: 'animal',
        rank: 'Kingdom',
        child: {
          AphiaID: 2,
          scientificname: 'fish',
          rank: 'Class',
          child: {
            AphiaID: 3, scientificname: 'salmon', rank: 'Species', child: null,
          },
        },
      });
    });
    const client = new WormsClient(fetcher);
    const progress = vi.fn();
    const imported = await client.prepare([
      taxon(4, 'old salmon', { status: 'unaccepted', valid_AphiaID: 3 }), taxon(3, 'salmon'),
    ], true, signal(), progress);
    expect(imported.types).toEqual(['salmon']);
    expect(imported.typeHierarchy).toEqual({ fish: 'animal', salmon: 'fish' });
    expect(imported.taxonomySources?.['3']).toEqual({ aphiaId: 3, scientificName: 'salmon', rank: 'Species' });
    expect(Object.keys(imported.taxonomySources!)).toEqual(['1', '2', '3']);
    expect(imported.synonymRemaps).toEqual([{ original: 'old salmon', accepted: 'salmon' }]);
    expect(imported.warnings).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(2);
    await client.prepare([taxon(3, 'salmon')], true, signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('warns when one synonym name resolves to multiple accepted taxa', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/10')) return response(taxon(10, 'Seriola dumerili'));
      if (url.endsWith('/20')) return response(taxon(20, 'Seriola hippos'));
      throw new Error(`unexpected ${url}`);
    });
    const imported = await new WormsClient(fetcher).prepare([
      taxon(1, 'Seriola gigas', { status: 'unaccepted', valid_AphiaID: 10 }),
      taxon(2, 'Seriola gigas', { status: 'unaccepted', valid_AphiaID: 20 }),
    ], false, signal());
    expect(imported.types).toEqual(['Seriola dumerili', 'Seriola hippos']);
    expect(imported.synonymRemaps).toEqual([
      { original: 'Seriola gigas', accepted: 'Seriola dumerili' },
      { original: 'Seriola gigas', accepted: 'Seriola hippos' },
    ]);
    expect(imported.warnings).toEqual([
      '"Seriola gigas" resolves to multiple accepted names: "Seriola dumerili", "Seriola hippos".',
    ]);
  });

  it('can import selected names without parent lookups', async () => {
    const fetcher = vi.fn();
    const imported = await new WormsClient(fetcher).prepare([taxon(1, 'fish')], false, signal());
    expect(imported.types).toEqual(['fish']);
    expect(imported.typeHierarchy).toBeUndefined();
    expect(imported.taxonomySources?.['1'].aphiaId).toBe(1);
    expect(imported.synonymRemaps).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects taxa without accepted names and ambiguous names', async () => {
    const client = new WormsClient(vi.fn());
    await expect(client.prepare([taxon(1, 'unknown', { status: 'unaccepted', valid_AphiaID: null })], false, signal()))
      .rejects.toThrow('no accepted');
    await expect(client.prepare([taxon(1, 'fish'), taxon(2, 'fish')], false, signal()))
      .rejects.toThrow('share the name');
  });

  it.each([null, {}, {
    AphiaID: 99, scientificname: 'other', rank: 'Species', child: null,
  }])('rejects malformed or incomplete classifications', async (classification) => {
    const client = new WormsClient(vi.fn().mockResolvedValue(response(classification)));
    await expect(client.prepare([taxon(1, 'fish')], true, signal())).rejects.toThrow();
  });

  it.each([429, 500])('reports HTTP %s without caching failures', async (status) => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(null, status)).mockResolvedValueOnce(response([]));
    const client = new WormsClient(fetcher);
    await expect(client.search('fish', 1, signal())).rejects.toThrow();
    expect(await client.search('fish', 1, signal())).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports network failures', async () => {
    const client = new WormsClient(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(client.search('fish', 1, signal())).rejects.toThrow('internet connection');
  });

  it('cancels requests and times out stalled requests', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url, options) => new Promise<Response>((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const client = new WormsClient(fetcher);
      const controller = new AbortController();
      const cancelled = expect(client.search('fish', 1, controller.signal)).rejects.toThrow('cancelled');
      controller.abort();
      await cancelled;
      const timeout = expect(client.search('fish', 1, signal())).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(20000);
      await timeout;
    } finally {
      vi.useRealTimers();
    }
  });
});
