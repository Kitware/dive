export interface JobStatusDef {
  value: number;
  text: string;
  icon: string;
  color: string;
  textColor?: string;
  indeterminate?: boolean;
  class?: string[];
}

const statusMap: Record<string, JobStatusDef> = {
  INACTIVE: {
    value: 0,
    text: 'Inactive',
    icon: 'mdi-pause',
    color: 'grey-lighten-1',
  },
  QUEUED: {
    value: 1,
    text: 'Queued',
    icon: 'mdi-dots-horizontal',
    color: 'yellow-darken-2',
    indeterminate: true,
  },
  RUNNING: {
    value: 2,
    text: 'Running',
    icon: 'mdi-autorenew',
    color: 'light-blue',
    class: ['mdi-spin'],
  },
  SUCCESS: {
    value: 3,
    text: 'Success',
    icon: 'mdi-check-circle',
    color: 'green',
  },
  ERROR: {
    value: 4,
    text: 'Error',
    icon: 'mdi-alert-circle',
    color: 'red',
  },
  CANCELED: {
    value: 5,
    text: 'Canceled',
    icon: 'mdi-close-circle',
    color: 'grey-darken-1',
  },
  WORKER_FETCHING_INPUT: {
    value: 820,
    text: 'Fetching input',
    icon: 'mdi-cloud-download',
    color: 'light-blue-lighten-2',
    indeterminate: true,
  },
  WORKER_CONVERTING_INPUT: {
    value: 821,
    text: 'Converting input',
    icon: 'mdi-shuffle',
    color: 'lime',
    indeterminate: true,
  },
  WORKER_CONVERTING_OUTPUT: {
    value: 822,
    text: 'Converting output',
    icon: 'mdi-shuffle',
    color: 'lime',
    indeterminate: true,
  },
  WORKER_PUSHING_OUTPUT: {
    value: 823,
    text: 'Pushing output',
    icon: 'mdi-cloud-upload',
    color: 'light-blue-lighten-2',
    indeterminate: true,
  },
  WORKER_CANCELING: {
    value: 824,
    text: 'Canceling',
    icon: 'mdi-alert',
    color: 'grey-darken-1',
    indeterminate: true,
  },
};

export function all() {
  return statusMap;
}

export function get(statusName: string) {
  return statusMap[statusName];
}

export function getByValue(value: number) {
  return Object.values(statusMap).find((status) => status.value === value);
}

export type Status = JobStatusDef;
