"""adds functionality to existing girder views"""
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import boundHandler
from girder.constants import AccessType
from girder.models.user import User

from dive_utils import constants


@access.user
@boundHandler
@autoDescribeRoute(
    Description('Set user use private queue')
    .modelParam("id", description='user id', model=User, level=AccessType.ADMIN)
    .param(
        "privateQueueEnabled",
        description="Set private queue enabled",
        paramType='query',
        dataType='boolean',
        default=None,
    )
)
def use_private_queue(self, user: dict, privateQueueEnabled: bool):
    if privateQueueEnabled is not None:
        user[constants.UserPrivateQueueEnabledMarker] = privateQueueEnabled
        User().save(user)
    return {
        constants.UserPrivateQueueEnabledMarker: user.get(
            constants.UserPrivateQueueEnabledMarker, False
        ),
    }
