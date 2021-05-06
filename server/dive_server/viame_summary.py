from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import SortDir
from girder.models.token import Token

from dive_server.utils import PydanticModel
from dive_tasks.summary import generate_summary
from dive_utils import models


class SummaryItem(PydanticModel):
    def initialize(self):
        return super().initialize("summaryItem", models.SummaryItemSchema)


class ViameSummary(Resource):
    def __init__(self):
        super(ViameSummary, self).__init__()
        self.resourceName = "viame_summary"

        self.route("GET", (), self.get_summary)
        self.route("POST", (), self.save_summary)
        self.route("POST", ("generate",), self.regenerate_summary)

    @access.admin
    @autoDescribeRoute(Description('Generate summary of published data'))
    def regenerate_summary(self, params):
        user = self.getCurrentUser()
        token = Token().createToken(user=user, days=14)
        generate_summary.apply_async(
            kwargs=dict(
                girder_client_token=str(token["_id"]),
                girder_job_title='Generate Summary of pubished data',
            ),
        )

    @access.admin
    @autoDescribeRoute(
        Description("Post summary response").jsonParam(
            "summary", "The JSON Body summary", paramType="body", requireObject=True
        )
    )
    def save_summary(self, params, summary):
        validate_summary = models.PublicDataSummary(**summary)
        SummaryItem().collection.remove({})  # drop existing summary
        for item in validate_summary.label_summary_items:
            SummaryItem().create(item)

    @access.user
    @autoDescribeRoute(
        Description("Summarize published datasets").pagingParams(
            "total_tracks", defaultSortDir=SortDir.DESCENDING
        )
    )
    def get_summary(self, params):
        limit, offset, sort = self.getPagingParameters(params)
        return SummaryItem().findWithPermissions(
            offset=offset, limit=limit, sort=sort, user=self.getCurrentUser()
        )
