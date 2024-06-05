"""adds functionality to existing girder views"""

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import boundHandler
from girder.constants import AccessType
from girder.models.user import User
from girder_jobs.models import job
from girder_worker.utils import JobStatus

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


@access.user
@boundHandler
@autoDescribeRoute(Description('Get number of outstanding jobs'))
def countJobs(self):
    outstanding = (
        job.Job()
        .find(
            {
                "status": {
                    "$in": [
                        JobStatus.INACTIVE,
                        JobStatus.QUEUED,
                        JobStatus.RUNNING,
                        JobStatus.CANCELING,
                        JobStatus.CONVERTING_INPUT,
                        JobStatus.CONVERTING_OUTPUT,
                        JobStatus.FETCHING_INPUT,
                        JobStatus.PUSHING_OUTPUT,
                    ]
                }
            }
        )
        .count()
    )

    return {
        'outstanding': outstanding,
    }
