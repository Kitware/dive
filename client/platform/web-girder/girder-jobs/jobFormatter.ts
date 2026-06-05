import moment from 'moment';

import { getByValue } from './status';

export interface GirderJob {
  _id: string;
  title: string;
  type: string;
  status: number;
  updated: string;
  progress?: { current: number; total: number };
  dataset_id?: string;
  kwargs?: string;
  [key: string]: unknown;
}

function progressAsNumber(progress?: { current: number; total: number }) {
  if (!progress?.total) {
    return 100;
  }
  return 100 * (progress.current / progress.total);
}

export function formatJob(job: GirderJob) {
  const statusDef = { text: 'Unknown', ...getByValue(job.status) };
  return {
    statusText: statusDef.text,
    statusColor: statusDef.color,
    statusTextColor: statusDef.textColor || 'white',
    statusIcon: statusDef.icon,
    updateString: moment(job.updated).format('dddd, MMMM D, YYYY @ h:mm a'),
    progressNumber: progressAsNumber(job.progress),
    indeterminate: statusDef.indeterminate,
    class: statusDef.class,
    ...job,
  };
}
