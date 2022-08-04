// Admin endpoints used for review and managment
import girderRest from 'platform/web-girder/plugins/girder';
import type { GirderJob, GirderModel } from '@girder/components/src';

export interface JobTypeStatus {
  status: number[];
  types: string[];
}

function getRecentDatasets(limit: number, offset: number) {
  return girderRest.get(`dive_dataset?limit=${limit}&sort=created&sortdir=-1&offset=${offset}&published=false&shared=false`);
}

function getJobTypesStatus() {
  return girderRest.get<JobTypeStatus>('job/typeandstatus/all');
}

function getRecentJobs(limit: number, offset: number, statuses?: number[], types?: string[]) {
  return girderRest.get<(GirderJob & { type: string})[]>('job/all', {
    params: {
      limit,
      offset,
      statuses: JSON.stringify(statuses),
      sort: 'created',
      sortdir: -1,
      types: JSON.stringify(types),
    },
  });
}

function getRecentUsers(limit: number, offset: number) {
  return girderRest.get<GirderModel[]>(`user?limit=${limit}&sort=created&sortdir=-1&offset=${offset}`);
}

function cancelJob(jobId: string) {
  return girderRest.put(`job/${jobId}/cancel`);
}

function deleteJob(jobId: string) {
  return girderRest.delete(`job/${jobId}`);
}


export {
  getRecentDatasets,
  getRecentJobs,
  getRecentUsers,
  getJobTypesStatus,
  cancelJob,
  deleteJob,
};
