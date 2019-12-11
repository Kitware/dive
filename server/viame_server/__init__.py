import datetime

from girder import events, plugin
from girder.api import access
from girder.utility import server
from girder.models.folder import Folder


from .client_webroot import ClientWebroot
from .viame import Viame
from .viame_detection import ViameDetection


class GirderPlugin(plugin.GirderPlugin):
    def load(self, info):
        info['apiRoot'].viame = Viame()
        info['apiRoot'].viame_detection = ViameDetection()
        # Relocate Girder
        info['serverRoot'], info['serverRoot'].girder = (ClientWebroot(),
                                                         info['serverRoot'])
        info['serverRoot'].api = info['serverRoot'].girder.api

