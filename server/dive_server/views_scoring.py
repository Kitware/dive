from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource

from . import crud_scoring


class ScoringResource(Resource):
    """Scoring results across every dataset the user can read."""

    def __init__(self, resourceName):
        super(ScoringResource, self).__init__()
        self.resourceName = resourceName

        self.route("GET", (), self.list_results)

    @access.user
    @autoDescribeRoute(Description("List every scoring result the user can read, newest first"))
    def list_results(self):
        return crud_scoring.list_all_results(self.getCurrentUser())
