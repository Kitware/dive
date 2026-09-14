import type { AddressInfo } from 'net';
import type http from 'http';
import {
  afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';

import { close, listen } from './server';

const mocks = vi.hoisted(() => ({ loadConfig: vi.fn() }));

vi.mock('electron', () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));
vi.mock('./state/settings', () => ({ default: { get: () => ({}) } }));
vi.mock('./native/common', () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: vi.fn(),
  saveAttributes: vi.fn(),
  saveAttributeTrackFilters: vi.fn(),
  saveDetections: vi.fn(),
  getDisplayImagePath: vi.fn(),
}));
vi.mock('./tiles/geotiffTiles', () => ({ getTilePng: vi.fn(), getTilesMetadata: vi.fn() }));
vi.mock('./media/displayProcessing', () => ({ getDisplayPng: vi.fn(), getDisplayHistogram: vi.fn() }));
vi.mock('./native/frameExtraction', () => ({
  getVideoInfo: vi.fn(), extractFrame: vi.fn(), prefetchFrames: vi.fn(),
}));

/**
 * The routes are declared at module scope, so a path pattern the router cannot
 * parse takes down the whole main process at import time rather than failing a
 * single request. Express 4 spelled the optional camera segment ':camera?';
 * Express 5 spells it '{/:camera}' and throws on the old form.
 */
describe('desktop backend routes', () => {
  let baseUrl = '';

  beforeAll(async () => {
    mocks.loadConfig.mockResolvedValue({ id: 'stub' });
    await new Promise<void>((resolve) => {
      listen((server: http.Server) => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://localhost:${port}/api`;
        resolve();
      });
    });
  });

  afterAll(() => close());

  it('matches a dataset route without a camera segment', async () => {
    const res = await fetch(`${baseUrl}/dataset/ds1/meta`);
    expect(res.status).toBe(200);
    expect(mocks.loadConfig).toHaveBeenLastCalledWith(expect.anything(), 'ds1', expect.any(Function));
  });

  it('matches a dataset route with a camera segment', async () => {
    const res = await fetch(`${baseUrl}/dataset/ds1/left/meta`);
    expect(res.status).toBe(200);
    expect(mocks.loadConfig).toHaveBeenLastCalledWith(expect.anything(), 'ds1/left', expect.any(Function));
  });
});
