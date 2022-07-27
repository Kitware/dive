import csv
import os
from typing import Dict, List
from urllib.parse import urlparse

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.models.setting import Setting
from girder.models.token import Token
from girder.utility import setting_utilities
import requests

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


@setting_utilities.validator({constants.INSTALLED_ADDONS_CONFIGS})
def validateInstalledAddons(doc):
    """Handle plugin-specific system settings. Right now we don't do any validation."""
    val = doc['value']
    if val is not None:
        # TODO: replace with real schema validation
        assert 'downloaded' in val, 'downloaded key not found in doc'


class ConfigurationResource(Resource):
    """Configuration resource handles get/set of global configuration"""

    def __init__(self, resourceName):
        super(ConfigurationResource, self).__init__()
        self.resourceName = resourceName

        self.route("GET", ("addons",), self.get_addons)
        self.route("GET", ("brand_data",), self.get_brand_data)
        self.route("GET", ("pipelines",), self.get_pipelines)
        self.route("GET", ("training_configs",), self.get_training_configs)

        self.route("PUT", ("brand_data",), self.update_brand_data)
        self.route("PUT", ("static_pipeline_configs",), self.update_static_pipeline_configs)
        self.route("PUT", ("installed_addons",), self.update_installed_addons)

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
        Description("Update the installed Addons for the system").jsonParam(
            "addons",
            "Update the downloaded addons for the system",
            required=True,
            requireObject=True,
            paramType='body',
        )
    )
    def update_installed_addons(self, addons: Dict):
        Setting().set(constants.INSTALLED_ADDONS_CONFIGS, addons)

    # https://github.com/VIAME/VIAME/raw/main/cmake/download_viame_addons.csv - CSV URL
    @access.admin
    @autoDescribeRoute(Description("Upgrade addon pipelines"))
    def get_addons(self):
        with requests.Session() as s:
            addons_config: List = Setting().get(constants.INSTALLED_ADDONS_CONFIGS) or {
                'downloaded': []
            }
            installed_addons = addons_config['downloaded']
            download = s.get(constants.AddonsListURL)
            decoded_content = download.content.decode('utf-8')
            cr = csv.reader(decoded_content.splitlines(), delimiter=',')
            my_list = list(cr)
            for item in my_list:
                addon = item[1]
                download_name = urlparse(addon).path.replace(os.path.sep, '_')
                item.append(f'{download_name}.zip' in installed_addons)
            return my_list

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
