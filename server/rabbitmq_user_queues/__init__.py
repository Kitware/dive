from girder import plugin
from .views import RabbitUserQueue


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        info["apiRoot"].rabbit_user_queues = RabbitUserQueue()
