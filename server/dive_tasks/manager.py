import datetime

import requests
from girder_worker.utils import JobManager


def _flush(self):
    """
    If there are contents in the buffer, send them up to the server. If the
    buffer is empty, this is a no-op.
    """
    if not self.url:
        return

    if (
        len(self._buf)
        or self._progressTotal
        or self._progressMessage
        or self._progressCurrent is not None
    ):
        data = {
            'progressTotal': self._progressTotal,
            'progressCurrent': self._progressCurrent,
            'progressMessage': self._progressMessage,
        }
        if self._buf:
            data['log'] = self._buf

        try:
            req = requests.request(
                self.method.upper(),
                self.url,
                allow_redirects=True,
                headers=self.headers,
                data=data,
            )
            req.raise_for_status()
        except requests.exceptions.HTTPError as err:
            if err.response.status_code >= 500 or err.response.status_code == 413:
                # Any 500 level error
                # The job record size has been exceeded.  Attempt to truncate the log
                data['overwrite'] = True
                data[
                    'log'
                ] = f'Log overflowed and was truncated at {datetime.datetime.utcnow()}'
                req_2 = requests.request(
                    self.method.upper(),
                    self.url,
                    allow_redirects=True,
                    headers=self.headers,
                    data=data,
                )
                req_2.raise_for_status()
            else:
                raise err
        self._buf = b""


def patch_manager(manager):
    """
    This is a monkey patch for girder worker job manager logging
    When writing logs to mongo, if the record size is exceeded,
    girder worker will throw a 500.

    This will catch the error and truncate the log so that the
    error doesn't interrupt a job run.

    This patch should be included with any celery job where the
    job manager is used.
    """
    manager.flush = _flush.__get__(manager, JobManager)
    return manager
