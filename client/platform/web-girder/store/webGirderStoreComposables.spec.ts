// @vitest-environment jsdom

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Route } from 'vue-router';

import { MultiType, VideoType } from '../../../dive-common/constants';

import * as api from '../api';
import * as configurationService from '../api/configuration.service';
import girderRest from '../plugins/girder';

import { bindWebGirderRouter, getUserHomeRoute, useLocation } from './useLocation';
import { useBrand } from './useBrand';
import { useConfig } from './useConfig';
import { useDataset } from './useDataset';
import { initJobs, useJobs } from './useJobs';
import { useUser } from './useUser';

function resetAllStoreState() {
  const user = useUser();
  user.setUser(null);

  const brand = useBrand();
  brand.setBrandData({
    name: 'DIVE',
    vuetify: null,
    favicon: undefined,
    logo: brand.getBrandData().logo,
    loginMessage: '',
    alertMessage: '',
    trainingMessage: '',
  });

  const config = useConfig();
  config.setCapabilities({
    distributedWorkerEnabled: false,
    pipelinesEnabled: false,
    trainingEnabled: false,
  });

  const dataset = useDataset();
  dataset.setMeta(null);

  const location = useLocation();
  location.setLocation(null);
  location.setSelected([]);

  const jobs = useJobs();
  jobs.jobIds.value = {};
  jobs.datasetStatus.value = {};
  jobs.completeJobsInfo.value = {};
}

describe('web-girder store composables', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAllStoreState();
  });

  describe('useUser', () => {
    it('setUser and getUser round-trip', () => {
      const { setUser, getUser } = useUser();
      const u = {
        admin: false,
        email: 'a@b.c',
        firstName: 'A',
        login: 'alice',
        lastName: 'B',
        status: 'active',
      };
      setUser(u);
      expect(getUser()).toEqual(u);
    });

    it('loadUser merges fetchUser result into user', async () => {
      const partial = {
        admin: true,
        email: 'x@y.z',
        firstName: 'X',
        login: 'bob',
        lastName: 'Y',
        status: 'active',
      };
      vi.spyOn(girderRest, 'fetchUser').mockResolvedValue(partial as never);
      useUser().setUser({
        admin: false,
        email: '',
        firstName: '',
        login: 'bob',
        lastName: '',
        status: 'active',
      });
      await useUser().loadUser();
      expect(useUser().getUser()).toMatchObject({
        login: 'bob',
        admin: true,
        email: 'x@y.z',
      });
    });
  });

  describe('useConfig', () => {
    it('setCapabilities maps API flags', async () => {
      vi.spyOn(configurationService, 'getConfig').mockResolvedValue({
        data: {
          distributedWorker: true,
          pipelinesEnabled: true,
          trainingEnabled: false,
        },
      } as never);
      await useConfig().loadConfig();
      expect(useConfig().getDistributedWorkerEnabled()).toBe(true);
      expect(useConfig().getPipelinesEnabled()).toBe(true);
      expect(useConfig().getTrainingEnabled()).toBe(false);
    });
  });

  describe('useBrand', () => {
    it('setBrandData merges partial brand', () => {
      const brand = useBrand();
      brand.setBrandData({ name: 'Test Brand' });
      expect(brand.getBrandData().name).toBe('Test Brand');
    });

    it('loadBrand applies API response', async () => {
      vi.spyOn(api, 'getBrandData').mockResolvedValue({
        data: {
          name: 'From API',
          vuetify: null,
          favicon: undefined,
          logo: '',
          loginMessage: '',
          alertMessage: '',
          trainingMessage: '',
        },
      } as never);
      await useBrand().loadBrand();
      expect(useBrand().getBrandData().name).toBe('From API');
    });
  });

  describe('useLocation', () => {
    it('setLocationFromRoute hydrates from route params', async () => {
      const route = {
        name: 'home',
        params: { routeType: 'collections' },
      } as unknown as Route;
      await useLocation().setLocationFromRoute(route);
      expect(useLocation().getLocation()).toEqual({ type: 'collections' });
    });

    it('setLocationFromRoute uses user home when route params are empty', async () => {
      const user = { _id: 'user123' };
      vi.spyOn(girderRest, 'user', 'get').mockReturnValue(user as never);
      const route = {
        name: 'home',
        params: {},
      } as unknown as Route;
      await useLocation().setLocationFromRoute(route);
      expect(useLocation().getLocation()).toEqual({
        _modelType: 'user',
        _id: 'user123',
      });
      expect(getUserHomeRoute()).toEqual({
        name: 'home',
        params: { routeType: 'user', routeId: 'user123' },
      });
    });

    it('hydrate loads unnamed folder via getFolder', async () => {
      vi.spyOn(api, 'getFolder').mockResolvedValue({
        data: {
          _id: 'f1',
          _modelType: 'folder',
          name: 'Hydrated',
        },
      } as never);
      await useLocation().hydrate({
        _id: 'f1',
        _modelType: 'folder',
      } as never);
      const loc = useLocation().getLocation() as { name?: string };
      expect(loc?.name).toBe('Hydrated');
    });

    it('setRouteFromLocation skips push for auxiliary under annotate folder', async () => {
      const push = vi.fn().mockResolvedValue(undefined);
      bindWebGirderRouter({ push } as never);
      const locApi = useLocation();
      locApi.setLocation({
        _id: 'ds',
        _modelType: 'folder',
        name: 'D',
        meta: { annotate: true },
      } as never);
      await locApi.setRouteFromLocation({
        _id: 'aux',
        _modelType: 'folder',
        name: 'auxiliary',
      } as never);
      expect(push).not.toHaveBeenCalled();
    });

    it('setRouteFromLocation pushes route when bound', async () => {
      const push = vi.fn().mockResolvedValue(undefined);
      bindWebGirderRouter({ push } as never);
      await useLocation().setRouteFromLocation({ type: 'users' });
      expect(push).toHaveBeenCalledWith('/users');
    });
  });

  describe('useDataset', () => {
    it('loadDataset merges metadata and hydrates parent location', async () => {
      vi.spyOn(api, 'getFolder').mockImplementation(async (id: string) => {
        if (id === 'ds1') {
          return {
            data: {
              parentId: 'p1',
              parentCollection: 'folder',
            },
          } as never;
        }
        if (id === 'p1') {
          return {
            data: {
              _id: 'p1',
              _modelType: 'folder',
              name: 'Parent',
            },
          } as never;
        }
        throw new Error(`unexpected getFolder(${id})`);
      });
      vi.spyOn(api, 'getDataset').mockResolvedValue({
        data: {
          id: 'ds1',
          type: VideoType,
          name: 'N',
          fps: 30,
          imageData: [],
          createdAt: '',
          subType: null,
          multiCamMedia: null,
          annotate: true,
        },
      } as never);
      vi.spyOn(api, 'getDatasetMedia').mockResolvedValue({
        data: {
          video: { url: 'http://video' },
        },
      } as never);

      const meta = await useDataset().loadDataset('ds1');
      expect(meta.type).toBe(VideoType);
      expect(meta.videoUrl).toBe('http://video');
      const parent = useLocation().getLocation() as { _id?: string; name?: string };
      expect(parent._id).toBe('p1');
      expect(parent.name).toBe('Parent');
    });

    it('loadDataset loads multi type parent with multiCamMedia', async () => {
      vi.spyOn(api, 'resolveDatasetFolderId').mockResolvedValue({
        folderId: 'm1',
        compositeId: null,
      });
      vi.spyOn(api, 'getFolder').mockImplementation(async (id: string) => {
        if (id === 'm1') {
          return {
            data: {
              parentId: 'p1',
              parentCollection: 'folder',
            },
          } as never;
        }
        if (id === 'p1') {
          return {
            data: {
              _id: 'p1',
              _modelType: 'folder',
              name: 'Parent',
            },
          } as never;
        }
        throw new Error(`unexpected getFolder(${id})`);
      });
      vi.spyOn(api, 'getDataset').mockResolvedValue({
        data: {
          id: 'm1',
          type: MultiType,
          name: 'Stereo',
          fps: 5,
          imageData: [],
          createdAt: '',
          subType: 'stereo',
          multiCamMedia: {
            defaultDisplay: 'left',
            cameras: {
              left: { type: 'image-sequence', imageData: [], videoUrl: '' },
              right: { type: 'image-sequence', imageData: [], videoUrl: '' },
            },
          },
          annotate: true,
        },
      } as never);
      vi.spyOn(api, 'getDatasetMedia').mockResolvedValue({
        data: { imageData: [] },
      } as never);

      const meta = await useDataset().loadDataset('m1');
      expect(meta.type).toBe(MultiType);
      expect(meta.subType).toBe('stereo');
      expect(meta.multiCamMedia?.defaultDisplay).toBe('left');
      expect(meta.imageData).toEqual([]);
      expect(meta.videoUrl).toBeUndefined();
      const browseLocation = useLocation().getLocation() as { _id?: string; name?: string };
      expect(browseLocation._id).toBe('p1');
      expect(browseLocation.name).toBe('Parent');
    });

    it('loadDataset composite id does not overwrite parent meta in store', async () => {
      const { loadDataset, meta } = useDataset();
      vi.spyOn(api, 'resolveDatasetFolderId').mockImplementation(async (datasetId: string) => {
        if (datasetId === 'm1') {
          return { folderId: 'm1', compositeId: null };
        }
        if (datasetId === 'm1/cam2') {
          return { folderId: 'child2', compositeId: 'm1/cam2' };
        }
        throw new Error(`unexpected resolve ${datasetId}`);
      });
      vi.spyOn(api, 'getFolder').mockImplementation(async (id: string) => {
        if (id === 'child2') {
          return {
            data: { parentId: 'm1', parentCollection: 'folder' },
          } as never;
        }
        if (id === 'm1') {
          return {
            data: {
              _id: 'm1',
              _modelType: 'folder',
              parentId: 'p1',
              parentCollection: 'folder',
              name: 'Multi',
            },
          } as never;
        }
        if (id === 'p1') {
          return {
            data: { _id: 'p1', _modelType: 'folder', name: 'Parent' },
          } as never;
        }
        throw new Error(`unexpected getFolder(${id})`);
      });
      vi.spyOn(api, 'getDataset').mockImplementation(async () => ({
        data: {
          id: 'm1',
          type: MultiType,
          name: 'Multi',
          fps: 5,
          imageData: [],
          createdAt: '',
          subType: 'multicam',
          multiCamMedia: {
            defaultDisplay: 'cam1',
            cameraOrder: ['cam1', 'cam2', 'cam3'],
            cameras: {
              cam1: { type: 'image-sequence', imageData: [], videoUrl: '' },
              cam2: { type: 'image-sequence', imageData: [], videoUrl: '' },
              cam3: { type: 'image-sequence', imageData: [], videoUrl: '' },
            },
          },
          annotate: true,
        },
      }) as never);
      vi.spyOn(api, 'getDatasetMedia').mockResolvedValue({ data: { imageData: [] } } as never);

      await loadDataset('m1');
      expect(meta.value?.type).toBe(MultiType);

      vi.spyOn(api, 'getDataset').mockResolvedValue({
        data: {
          id: 'm1/cam2',
          type: VideoType,
          name: 'cam2',
          fps: 5,
          imageData: [],
          createdAt: '',
          subType: null,
          multiCamMedia: null,
          annotate: true,
        },
      } as never);
      vi.spyOn(api, 'getDatasetMedia').mockResolvedValue({
        data: { video: { url: 'http://cam2' } },
      } as never);

      const childMeta = await loadDataset('m1/cam2');
      expect(childMeta.type).toBe(VideoType);
      expect(meta.value?.type).toBe(MultiType);
      expect(meta.value?.multiCamMedia?.cameraOrder).toEqual(['cam1', 'cam2', 'cam3']);
      const browseLocation = useLocation().getLocation() as { _id?: string; name?: string };
      expect(browseLocation._id).toBe('p1');
      expect(browseLocation.name).toBe('Parent');
    });

    it('loadDataset composite id primes parent meta when store is empty', async () => {
      const { loadDataset, meta, setMeta } = useDataset();
      setMeta(null);
      vi.spyOn(api, 'resolveDatasetFolderId').mockResolvedValue({
        folderId: 'child1',
        compositeId: 'm1/left',
      });
      vi.spyOn(api, 'getFolder').mockImplementation(async (id: string) => {
        if (id === 'child1') {
          return {
            data: { parentId: 'm1', parentCollection: 'folder' },
          } as never;
        }
        if (id === 'm1') {
          return {
            data: {
              _id: 'm1',
              _modelType: 'folder',
              parentId: 'p1',
              parentCollection: 'folder',
              name: 'Stereo',
            },
          } as never;
        }
        if (id === 'p1') {
          return {
            data: { _id: 'p1', _modelType: 'folder', name: 'Parent' },
          } as never;
        }
        throw new Error(`unexpected getFolder(${id})`);
      });
      vi.spyOn(api, 'getDataset').mockResolvedValue({
        data: {
          id: 'm1',
          type: MultiType,
          name: 'Stereo',
          fps: 5,
          imageData: [],
          createdAt: '',
          subType: 'stereo',
          multiCamMedia: {
            defaultDisplay: 'left',
            cameras: { left: {}, right: {} },
          },
          annotate: true,
        },
      } as never);
      vi.spyOn(api, 'getDatasetMedia').mockResolvedValue({
        data: { imageData: [{ url: 'x' }] },
      } as never);

      await loadDataset('m1/left');
      expect(meta.value?.subType).toBe('stereo');
      expect(meta.value?.type).toBe(MultiType);
      const browseLocation = useLocation().getLocation() as { _id?: string; name?: string };
      expect(browseLocation._id).toBe('p1');
      expect(browseLocation.name).toBe('Parent');
    });
  });

  describe('useJobs', () => {
    it('setJobState and runningJobIds track running status', () => {
      const jobs = useJobs();
      jobs.setJobState({ jobId: 'j1', value: 2 });
      expect(jobs.getRunningJobIds()).toBe(true);
      jobs.setJobState({ jobId: 'j1', value: 3 });
      expect(jobs.getRunningJobIds()).toBe(false);
    });

    it('getDatasetRunningState returns job link while running', () => {
      const jobs = useJobs();
      jobs.setDatasetStatus({ datasetId: 'd1', status: 2, jobId: 'job99' });
      expect(jobs.getDatasetRunningState('d1')).toBe('/girder/#job/job99');
    });

    it('setCompleteJobsInfo and removeCompleteJob', () => {
      const jobs = useJobs();
      jobs.setCompleteJobsInfo({
        datasetId: 'd1',
        type: 'pipelines',
        title: 'T',
        success: true,
      });
      expect(jobs.getDatasetCompleteJobs('d1')).toMatchObject({ type: 'pipelines', success: true });
      jobs.removeCompleteJob({ datasetId: 'd1' });
      expect(jobs.getDatasetCompleteJobs('d1')).toBe(false);
    });
  });

  describe('initJobs', () => {
    it('fetches running jobs and subscribes to job status messages', async () => {
      const job = {
        _id: 'job1',
        status: 2,
        dataset_id: 'ds1',
        type: 'pipelines',
        title: 'P',
      };
      vi.spyOn(girderRest, 'get').mockResolvedValue({ data: [job] } as never);
      vi.spyOn(girderRest, '$on').mockImplementation(() => girderRest);
      await initJobs();
      expect(girderRest.get).toHaveBeenCalled();
      expect(girderRest.$on).toHaveBeenCalledWith('message:job_status', expect.any(Function));
      expect(useJobs().getJobIds().job1).toBe(2);
    });
  });
});
