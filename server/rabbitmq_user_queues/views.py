from typing import Tuple
import uuid

from girder import logger
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.user import User
from pydantic import ValidationError
from pyrabbit2 import Client as PyRabbitClient
from dive_utils.types import GirderModel

from .constants import UserQueueMarker
from .models import Settings, UserQueueModel


class RabbitUserQueue(Resource):
    def __init__(self):
        super(RabbitUserQueue, self).__init__()
        self.resourceName = "rabbit_user_queues"
        self.route("POST", ("user", ":id"), self.upsert_user_queue)
        self.route("GET", ("ping",), self.ping)

    def getClient(self) -> Tuple[Settings, PyRabbitClient]:
        s = Settings()
        return s, PyRabbitClient(s.url, s.username, s.password)

    @access.user
    @autoDescribeRoute(
        Description("Get or create user queue").modelParam(
            "id", description="User ID", model=User
        )
    )
    def upsert_user_queue(self, user: GirderModel):
        if user[UserQueueMarker] is not None:
            try:
                parsed_credentials = UserQueueModel(**user[UserQueueMarker])
                return parsed_credentials.dict()
            except ValidationError as e:
                pass

        # Generate new credentials
        settings, client = self.getClient()
        username = user['login']
        password = str(uuid.uuid4())
        client.create_user(username, password=password)
        pattern = f"{username}.*"
        client.set_vhost_permissions(
            settings.vhost, username, pattern, pattern, pattern
        )

    @access.admin
    @autoDescribeRoute(Description("Ping"))
    def ping(self, params):
        return self.getClient()[1].get_overview()
