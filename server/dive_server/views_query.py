"""Private, queued image queries and reusable dataset index snapshots."""

import base64
import binascii
from datetime import datetime, timezone
import io
import json
import uuid

from girder.api import access
from girder.api.describe import Description, autoDescribeRoute
from girder.api.rest import Resource
from girder.constants import AccessType
from girder.exceptions import AccessException, RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.token import Token
from girder.models.upload import Upload

from dive_tasks.run_query import run_query
from dive_utils import constants
from dive_utils.query import validate_query_request

from . import crud_rpc, worker_capabilities

MARKER = 'diveQuery'


def load_dataset(dataset_id, user):
    folder = Folder().load(dataset_id, user=user, level=AccessType.READ, exc=True)
    if not folder.get('meta', {}).get(constants.DatasetMarker) or folder['meta'].get(
        constants.TypeMarker
    ) not in (constants.VideoType, constants.ImageSequenceType):
        raise RestException('Choose a video or image sequence (or an individual camera).')
    return folder


def load_artifact(folder_id, user):
    folder = Folder().load(folder_id, user=user, level=AccessType.READ, exc=True)
    meta = folder.get('meta', {}).get(MARKER)
    if not meta or str(folder.get('creatorId')) != str(user['_id']):
        raise AccessException('Query artifacts belong to their creator.')
    for dataset_id in meta['datasetIds']:
        load_dataset(dataset_id, user)
    return folder, meta


def artifact_file(folder, name):
    item = Item().findOne({'folderId': folder['_id'], 'name': name})
    return next(Item().childFiles(item), None) if item else None


class QueryResource(Resource):
    def __init__(self, resourceName):
        super().__init__()
        self.resourceName = resourceName
        self.route('GET', (), self.list_indexes)
        self.route('GET', (':id',), self.status)
        self.route('GET', (':id', 'request'), self.request)
        self.route('POST', (), self.submit)

    @access.user
    @autoDescribeRoute(Description('List your reusable query index snapshots'))
    def list_indexes(self):
        user = self.getCurrentUser()
        result = []
        for folder in Folder().find(
            {
                'creatorId': user['_id'],
                f'meta.{MARKER}.operation': 'index',
            },
            sort=[('created', -1)],
        ):
            try:
                _, meta = load_artifact(folder['_id'], user)
            except (AccessException, RestException):
                continue
            result.append(
                {
                    'id': str(folder['_id']),
                    **meta,
                    'ready': artifact_file(folder, 'index.zip') is not None,
                }
            )
        return result

    @access.user
    @autoDescribeRoute(Description('Read query status and results').param('id', 'Query folder'))
    def status(self, id):
        folder, meta = load_artifact(id, self.getCurrentUser())
        result = {'id': str(folder['_id']), **meta}
        output = artifact_file(folder, 'results.json')
        if output:
            result['response'] = json.loads(b''.join(File().download(output, headers=False)()))
        result['ready'] = artifact_file(folder, 'index.zip') is not None
        return result

    @access.user
    @autoDescribeRoute(
        Description('Restore a query exemplar and feedback').param('id', 'Query folder')
    )
    def request(self, id):
        folder, meta = load_artifact(id, self.getCurrentUser())
        if meta['operation'] != 'search':
            raise RestException('This artifact is not a search.')
        request = artifact_file(folder, 'request.json')
        image = artifact_file(folder, 'exemplar.png')
        if not request or not image:
            raise RestException('The query input is missing.')
        result = json.loads(b''.join(File().download(request, headers=False)()))
        result['image'] = base64.b64encode(
            b''.join(File().download(image, headers=False)())
        ).decode()
        return result

    @access.user
    @autoDescribeRoute(
        Description('Queue an index build or image query').jsonParam(
            'body',
            'Index or search request',
            paramType='body',
            requireObject=True,
        )
    )
    def submit(self, body):
        worker_capabilities.require_pipeline_worker()
        user = self.getCurrentUser()
        try:
            request = validate_query_request(body)
        except ValueError as exc:
            raise RestException(str(exc))
        params = dict(request)
        if request['operation'] == 'index':
            dataset = load_dataset(request['datasetId'], user)
            dataset_ids = [str(dataset['_id'])]
            name = dataset['name']
        else:
            dataset_ids, indexes = [], []
            for index_id in request['indexIds']:
                index, meta = load_artifact(index_id, user)
                file = artifact_file(index, 'index.zip')
                if meta['operation'] != 'index' or file is None:
                    raise RestException('Wait for all selected indexes to finish.')
                dataset_ids.extend(meta['datasetIds'])
                indexes.append({'fileId': str(file['_id']), 'datasetId': meta['datasetIds'][0]})
            params['indexes'] = indexes
            name = 'Image query'
        image = None
        if request['operation'] == 'search':
            try:
                image = base64.b64decode(params.pop('image'), validate=True)
            except (ValueError, binascii.Error):
                raise RestException('Invalid PNG exemplar.')
            if len(image) > 10 * 1024 * 1024:
                raise RestException('Choose a PNG exemplar smaller than 10 MB.')
            if not image.startswith(b'\x89PNG\r\n\x1a\n'):
                raise RestException('The exemplar must be a PNG image.')
        # A fresh private folder for every job; no shared mutable index or session.
        folder = Folder().createFolder(
            user,
            f'Query {uuid.uuid4().hex}',
            parentType='user',
            creator=user,
            public=False,
        )
        meta = {
            'operation': request['operation'],
            'datasetIds': dataset_ids,
            'name': name,
            'created': datetime.now(timezone.utc).isoformat(),
            'method': request.get('method'),
        }
        Folder().setMetadata(folder, {MARKER: meta})
        if image is not None:
            upload = Upload().uploadFromFile(
                io.BytesIO(image),
                len(image),
                'exemplar.png',
                parentType='folder',
                parent=folder,
                user=user,
                mimeType='image/png',
            )
            params['imageFileId'] = str(upload['_id'])
            saved_request = json.dumps(
                {key: value for key, value in request.items() if key != 'image'}
            ).encode()
            Upload().uploadFromFile(
                io.BytesIO(saved_request),
                len(saved_request),
                'request.json',
                parentType='folder',
                parent=folder,
                user=user,
                mimeType='application/json',
            )
        params['outputFolderId'] = str(folder['_id'])
        params['datasetIds'] = dataset_ids
        token = Token().createToken(user=user, days=14)
        private = user.get(constants.UserPrivateQueueEnabledMarker, False)
        job = run_query.apply_async(
            queue=crud_rpc._get_queue_name(user, 'pipelines'),
            kwargs=dict(
                params=params,
                girder_job_title=f"Query: {name}",
                girder_client_token=str(token['_id']),
                girder_job_type='private' if private else 'query',
            ),
        )
        job = crud_rpc._persist_async_job_metadata(
            job,
            access_source=folder,
            **{
                constants.JOBCONST_PRIVATE_QUEUE: private,
                constants.JOBCONST_CREATOR: str(user['_id']),
            },
        )
        meta['jobId'] = str(job['_id'])
        Folder().setMetadata(folder, {MARKER: meta})
        return {'id': str(folder['_id']), **meta}
