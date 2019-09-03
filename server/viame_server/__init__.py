import datetime
from girder import events, plugin
from girder.models.user import User
from girder.utility import server

from .client_webroot import ClientWebroot


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        # Relocate Girder
        info['serverRoot'], info['serverRoot'].girder = (ClientWebroot(),
                                                         info['serverRoot'])
        info['serverRoot'].api = info['serverRoot'].girder.api
