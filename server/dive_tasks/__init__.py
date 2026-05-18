import logging

from girder_worker import GirderWorkerPluginABC

logging.basicConfig(format="%(levelname)s:%(message)s", level=logging.INFO)


class DIVEPlugin(GirderWorkerPluginABC):
    def __init__(self, app, *args, **kwargs):
        self.app = app

    def task_imports(self):
        # Return a list of python importable paths to the
        # plugin's path directory
        # worker_girder_events first: bind Girder handlers before any task module loads.
        return [
            'dive_tasks.worker_girder_events',
            'dive_tasks.tasks',
            'dive_tasks.local_tasks',
        ]
