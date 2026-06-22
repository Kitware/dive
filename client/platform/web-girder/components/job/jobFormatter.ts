import moment from 'moment';

import { getByValue } from './status';

export function progressAsNumber(progress?: { current?: number; total?: number }) {
  if (!progress || !progress.total) {
    return 100;
  }
  return 100 * ((progress.current || 0) / progress.total);
}

export function formatJob(job: Record<string, unknown>) {
  const statusDef = { text: 'Unknown', ...getByValue(job.status as number) };
  return {
    statusText: statusDef.text,
    statusColor: statusDef.color,
    statusTextColor: statusDef.textColor || 'white',
    statusIcon: statusDef.icon,
    updateString: moment(job.updated as string).format('dddd, MMMM D, YYYY @ h:mm a'),
    progressNumber: progressAsNumber(job.progress as { current?: number; total?: number }),
    indeterminate: statusDef.indeterminate,
    class: statusDef.class,
    ...job,
  };
}
