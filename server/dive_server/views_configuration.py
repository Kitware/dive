from typing import List

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.setting import Setting
from girder.models.token import Token
from girder.utility import setting_utilities

from dive_server import crud, crud_rpc
from dive_tasks import tasks
from dive_utils import constants, models, types


@setting_utilities.validator({constants.SETTINGS_CONST_JOBS_CONFIGS})
def validateJobConfigs(doc):
    """Handle plugin-specific system settings. Right now we don't do any validation."""
    val = doc['value']
    if val is not None:
        # TODO: replace with real schema validation
        assert 'training' in val, '"training" missing from doc'
        assert 'pipelines' in val, '"piplines" missing from doc'


@setting_utilities.validator({constants.BRAND_DATA_CONFIG})
def validateBrandData(doc):
    val = doc['value']
    if val is not None:
        crud.get_validated_model(models.BrandData, **val)


class ConfigurationResource(Resource):
    """Configuration resource handles get/set of global configuration"""

    def __init__(self, resourceName):
        super(ConfigurationResource, self).__init__()
        self.resourceName = resourceName

        self.route("GET", ("brand_data",), self.get_brand_data)
        self.route("GET", ("pipelines",), self.get_pipelines)
        self.route("GET", ("training_configs",), self.get_training_configs)

        self.route("PUT", ("brand_data",), self.update_brand_data)
        self.route("PUT", ("static_pipeline_configs",), self.update_static_pipeline_configs)

        self.route("POST", ("upgrade_pipelines",), self.upgrade_pipelines)

    @access.public
    @autoDescribeRoute(Description("Get custom brand data"))
    def get_brand_data(self):
        return Setting().get(constants.BRAND_DATA_CONFIG) or {}

    @access.user
    @autoDescribeRoute(Description("Get available pipeline configurations"))
    def get_pipelines(self, params):
        return crud_rpc.load_pipelines(self.getCurrentUser())

    @access.user
    @autoDescribeRoute(Description("Get available training configs"))
    def get_training_configs(self, params):
        static_job_configs: types.AvailableJobSchema = (
            Setting().get(constants.SETTINGS_CONST_JOBS_CONFIGS) or {}
        )
        return static_job_configs.get('training', {})

    @access.admin
    @autoDescribeRoute(
        Description("update brand data").jsonParam(
            "data", "Brand Data", paramType='body', requireObject=True, required=True
        )
    )
    def update_brand_data(self, data):
        Setting().set(constants.BRAND_DATA_CONFIG, data)

    @access.admin
    @autoDescribeRoute(
        Description("Persist discovered static pipeline configurations").jsonParam(
            "configs",
            "Replace static pipeline configurations",
            required=True,
            requireObject=True,
            paramType='body',
        )
    )
    def update_static_pipeline_configs(self, configs: types.AvailableJobSchema):
        Setting().set(constants.SETTINGS_CONST_JOBS_CONFIGS, configs)

    @access.admin
    @autoDescribeRoute(
        Description("Upgrade addon pipelines")
        .param(
            "force",
            "Force re-download of all addons.",
            paramType="query",
            dataType="boolean",
            default=False,
            required=False,
        )
        .jsonParam(
            "urls",
            "List of public URLs for addon zipfiles",
            paramType='body',
            requireArray=True,
            required=False,
            default=tasks.UPGRADE_JOB_DEFAULT_URLS,
        )
    )
    def upgrade_pipelines(self, force: bool, urls: List[str]):
        token = Token().createToken(user=self.getCurrentUser(), days=1)
        Setting().set(constants.SETTINGS_CONST_JOBS_CONFIGS, None)
        tasks.upgrade_pipelines.delay(
            urls=urls,
            force=force,
            girder_job_title="Upgrade Pipelines",
            girder_client_token=str(token["_id"]),
        )
