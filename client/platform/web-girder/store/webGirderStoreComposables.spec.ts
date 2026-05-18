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

import { bindWebGirderRouter, useLocation } from './useLocation';
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

    it('loadDataset rejects multi type', async () => {
      vi.spyOn(api, 'getFolder').mockResolvedValue({
        data: { parentId: 'p', parentCollection: 'folder' },
      } as never);
      vi.spyOn(api, 'getDataset').mockResolvedValue({
        data: {
          id: 'm',
          type: MultiType,
          name: '',
          fps: 1,
          imageData: [],
          createdAt: '',
          subType: null,
          multiCamMedia: null,
          annotate: false,
        },
      } as never);
      vi.spyOn(api, 'getDatasetMedia').mockResolvedValue({ data: {} } as never);

      await expect(useDataset().loadDataset('m1')).rejects.toThrow('multi is not supported');
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
