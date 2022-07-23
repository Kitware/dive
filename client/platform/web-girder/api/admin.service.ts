// Admin endpoints used for review and managment
import girderRest from 'platform/web-girder/plugins/girder';
import type { GirderJob, GirderModel } from '@girder/components/src';


function getRecentDatasets(limit: number, offset: number) {
  return girderRest.get(`dive_dataset?limit=${limit}&sort=created&sortdir=-1&offset=${offset}&published=false&shared=false`);
}

function getRecentJobs(limit: number, offset: number, type?: string) {
  let base = `job/all?limit=${limit}&sort=created&sortdir=-1&offset=${offset}`;
  if (type) {
    base = `${base}&type=${type}`;
  }
  return girderRest.get<GirderJob[]>(base);
}

function getRecentUsers(limit: number, offset: number) {
  return girderRest.get<GirderModel[]>(`user?limit=${limit}&sort=created&sortdir=-1&offset=${offset}`);
}

export {
  getRecentDatasets,
  getRecentJobs,
  getRecentUsers,
};
