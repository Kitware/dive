const statusMap = {
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

function all() {
  return statusMap;
}

function get(statusName) {
  return statusMap[statusName];
}

function getByValue(value) {
  return Object.values(statusMap).find((status) => status.value === value);
}

function register(status = {}) {
  Object.assign(statusMap, status);
}

export {
  all,
  get,
  getByValue,
  register,
};
