import csv
from datetime import datetime, timedelta, timezone
import os
from typing import Dict, List
from urllib.parse import urlparse

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.setting import Setting
from girder.models.token import Token
from girder.models.user import User
from girder.utility import setting_utilities
from girder_jobs.models.job import Job
import requests

from dive_server import crud, crud_rpc
from dive_tasks import tasks
from dive_utils import TRUTHY_META_VALUES, constants, models, types


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
        assert 'downloaded' in val, 'downloaded key not found in doc'
        assert isinstance(val['downloaded'], list), 'downloaded key is not a list'


class ConfigurationResource(Resource):
    """Configuration resource handles get/set of global configuration"""

    def __init__(self, resourceName):
        super(ConfigurationResource, self).__init__()
        self.resourceName = resourceName

        self.route("GET", (), self.get_config)
        self.route("GET", ("addons",), self.get_addons)
        self.route("GET", ("brand_data",), self.get_brand_data)
        self.route("GET", ("pipelines",), self.get_pipelines)
        self.route("GET", ("training_configs",), self.get_training_configs)

        self.route("PUT", ("brand_data",), self.update_brand_data)
        self.route("PUT", ("static_pipeline_configs",), self.update_static_pipeline_configs)
        self.route("PUT", ("installed_addons",), self.update_installed_addons)
        self.route("POST", ("upgrade_pipelines",), self.upgrade_pipelines)
        self.route("POST", ("update_containers",), self.update_containers)
        self.route("GET", ("stats",), self.get_dataset_stats)

    @access.public
    @autoDescribeRoute(Description("Get Configuration Information"))
    def get_config(self):
        env = os.environ.copy()

        distributed_worker = env.get("RABBITMQ_DISTRIBUTED_WORKER")
        return {'distributedWorker': distributed_worker}

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
        model_configs = crud_rpc.load_training_configs(self.getCurrentUser())
        training_configs = {
            "training": static_job_configs.get('training', {}),
            "models": model_configs,
        }
        return training_configs

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

    @access.admin
    @autoDescribeRoute(
        Description(
            "Force an update to the docker containers through watchtower using http interface"
        )
    )
    def update_containers(self):
        try:
            print('Sending Post Request')
            url = "http://watchtower:8080/v1/update"
            token = os.environ.get("WATCHTOWER_API_TOKEN", "mytoken")
            headers = {"Authorization": f"Bearer {token}"}
            req = requests.get(url, headers=headers)
            req.raise_for_status()
            return "Update Successful"
        except requests.exceptions.HTTPError as err:
            return f"HTTP error occurred: {err}"
        except requests.exceptions.ConnectionError as err:
            return f"Error Connecting: {err}"
        except requests.exceptions.Timeout as err:
            return f"Timeout Error: {err}"
        except requests.exceptions.RequestException as err:
            return f"Something went wrong: {err}"

    @access.admin
    @autoDescribeRoute(
        Description("Get dataset and job statistics within a specified time range")
        .param(
            "dateRange",
            "Predefined date range selection",
            required=False,
            dataType="string",
            default="6 months",
            enum=["60 days", "3 months", "6 months", "1 year", "3 years", "5 years"],
        )
        .param(
            "overrideDateTime",
            "Custom start and end timestamps (ISO format, comma-separated)",
            required=False,
            dataType="string",
        )
        .param(
            "groupBy",
            "Group results by either 'user' or 'month'",
            required=False,
            dataType="string",
            enum=["user", "month"],
            default="",
        )
        .param(
            "limit",
            "Limit the number of top users to display (for 'user' groupBy)",
            dataType="integer",
            required=False,
            default=50,
        )
    )
    def get_dataset_stats(self, dateRange=None, overrideDateTime=None, groupBy="month", limit=50):
        # Default to now (end date)
        end_dt = datetime.now(timezone.utc)

        # Date range mappings
        date_map = {
            "60 days": timedelta(days=60),
            "3 months": timedelta(days=90),
            "6 months": timedelta(days=180),
            "1 year": timedelta(days=365),
            "3 years": timedelta(days=3 * 365),
            "5 years": timedelta(days=5 * 365),
        }

        if overrideDateTime:
            try:
                start_str, end_str = overrideDateTime.split(",")
                start_dt = datetime.fromisoformat(start_str.strip())
                end_dt = datetime.fromisoformat(end_str.strip())
            except ValueError:
                raise RestException(
                    "Invalid overrideDateTime format. Use ISO format:\
                          'YYYY-MM-DDTHH:MM:SS, YYYY-MM-DDTHH:MM:SS'"
                )
        elif dateRange and dateRange in date_map:
            start_dt = end_dt - date_map[dateRange]
        else:
            # Default to 6 months if no range is provided
            start_dt = end_dt - timedelta(days=180)

        user = self.getCurrentUser()

        # Prepare the month range if needed
        month_range = {}
        temp_dt = start_dt.replace(day=1)
        while temp_dt <= end_dt:
            key = f"{temp_dt.year}-{temp_dt.month:02d}"
            month_range[key] = 0
            temp_dt = (temp_dt.replace(day=28) + timedelta(days=4)).replace(day=1)

        def fill_missing_months(results):
            """Ensure every month in range exists, defaulting to 0 if missing."""
            for month in month_range.keys():
                if month not in results.keys():
                    results[month] = 0
            return results

        # Query for datasets created in the given time range
        dataset_query = {
            '$and': [
                {f'meta.{constants.DatasetMarker}': {'$in': TRUTHY_META_VALUES}},
                Folder().permissionClauses(user=user, level=AccessType.READ),
                {"created": {"$gte": start_dt, "$lte": end_dt}},
            ]
        }

        user_map = {str(user["_id"]): user["login"] for user in User().find({})}

        table_stats = {'datasets': 0, 'jobs': {}, 'newUsers': 0}
        group_by_user = {'datasets': 0, 'jobs': 0}
        group_by_month = {'datasets': {}, 'jobs': {}, 'newUsers': {}}
        # Query logic based on groupBy parameter
        if groupBy == "user":
            dataset_pipeline = [
                {"$match": dataset_query},
                {"$group": {"_id": "$creatorId", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},  # Sort by count in descending order
                {"$limit": limit},  # Limit to top N users
            ]
            dataset_results = list(Folder().collection.aggregate(dataset_pipeline))
            dataset_stats = {
                user_map.get(str(entry["_id"]), "Unknown"): entry["count"]
                for entry in dataset_results
            }
            group_by_user['datasets'] = dataset_stats
        elif groupBy == "month":
            dataset_pipeline = [
                {"$match": dataset_query},
                {
                    "$group": {
                        "_id": {"year": {"$year": "$created"}, "month": {"$month": "$created"}},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id.year": 1, "_id.month": 1}},
            ]
            dataset_results = list(Folder().collection.aggregate(dataset_pipeline))
            dataset_stats = {
                f"{entry['_id']['year']}-{entry['_id']['month']:02d}": entry["count"]
                for entry in dataset_results
            }
            dataset_stats = fill_missing_months(dataset_stats)
            group_by_month['datasets'] = dataset_stats

        table_stats['datasets'] = Folder().find(dataset_query).count()

        # Query for new users created in the given time range
        if groupBy == "month":
            user_pipeline = [
                {"$match": {"created": {"$gte": start_dt, "$lte": end_dt}}},
                {
                    "$group": {
                        "_id": {"year": {"$year": "$created"}, "month": {"$month": "$created"}},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id.year": 1, "_id.month": 1}},
            ]
            user_results = list(User().collection.aggregate(user_pipeline))
            new_users_count = {
                f"{entry['_id']['year']}-{entry['_id']['month']:02d}": entry["count"]
                for entry in user_results
            }
            new_users_count = fill_missing_months(new_users_count)
            group_by_month['newUsers'] = new_users_count

        table_stats['newUsers'] = (
            User().find({"created": {"$gte": start_dt, "$lte": end_dt}}).count()
        )

        # Query for jobs created in the given time range
        job_query = {"created": {"$gte": start_dt, "$lte": end_dt}}

        if groupBy == "user":
            job_pipeline = [
                {"$match": job_query},
                {"$group": {"_id": "$userId", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},  # Sort by count in descending order
                {"$limit": limit},  # Limit to top N users
            ]
            job_results = list(Job().collection.aggregate(job_pipeline))
            job_stats = {
                user_map.get(str(entry["_id"]), "Unknown"): entry["count"] for entry in job_results
            }
            group_by_user["jobs"] = job_stats
        elif groupBy == "month":
            job_pipeline = [
                {"$match": job_query},
                {
                    "$group": {
                        "_id": {"year": {"$year": "$created"}, "month": {"$month": "$created"}},
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id.year": 1, "_id.month": 1}},
            ]
            job_results = list(Job().collection.aggregate(job_pipeline))
            job_stats = {
                f"{entry['_id']['year']}-{entry['_id']['month']:02d}": entry["count"]
                for entry in job_results
            }
            job_stats = fill_missing_months(job_stats)
            group_by_month['jobs'] = job_stats
        job_pipeline = [
            {"$match": job_query},
            {"$group": {"_id": "$type", "count": {"$sum": 1}}},
        ]
        job_results = list(Job().collection.aggregate(job_pipeline))
        table_stats['jobs'] = {entry["_id"]: entry["count"] for entry in job_results}

        output = {
            "table_stats": table_stats,
        }
        if groupBy == 'user':
            output['groupByUser'] = group_by_user
        if groupBy == 'month':
            output['groupByMonth'] = group_by_month
        return output
