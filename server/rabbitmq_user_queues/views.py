from typing import Tuple
import uuid

from girder import logger
from girder.constants import AccessType
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
        return s, PyRabbitClient(
            s.netloc,
            s.username,
            s.password,
            scheme=s.scheme,
        )

    @access.user
    @autoDescribeRoute(
        Description("Get or create user queue")
        .modelParam("id", description="User ID", model=User, level=AccessType.ADMIN)
        .param('force', description='Force refresh', default=False, dataType='boolean')
    )
    def upsert_user_queue(self, user: GirderModel, force):
        existing = user.get(UserQueueMarker, None)
        if existing is not None and not force:
            try:
                parsed_credentials = UserQueueModel(**existing)
                return parsed_credentials.dict()
            except ValidationError as e:
                pass

        # Generate new credentials
        settings, client = self.getClient()
        newUserQueue = UserQueueModel(
            **{
                'username': user['login'],
                'password': str(uuid.uuid4()),
            }
        )
        client.create_user(newUserQueue.username, password=newUserQueue.password)

        # Allow remote control queues, since celery docs are wrong and disabling it isn't possible
        # because celery is a liar https://celery-rabbitmq.readthedocs.io/en/latest/remotecontrol.html
        pattern = f"^({newUserQueue.username}.*|(celery@)?([a-fA-F0-9-]+\.)?(reply\.)?celery\.pidbox)$"
        client.set_vhost_permissions(
            settings.vhost, newUserQueue.username, pattern, pattern, pattern
        )
        user[UserQueueMarker] = newUserQueue.dict()
        User().save(user)
        return user[UserQueueMarker]

    @access.admin
    @autoDescribeRoute(Description("Ping"))
    def ping(self, params):
        return self.getClient()[1].get_overview()
