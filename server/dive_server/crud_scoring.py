"""Scoring results persisted by dive_tasks.run_scoring in a dataset's auxiliary folder."""

from datetime import datetime
import json
from typing import Any, Dict, List, Optional

from girder.constants import AccessType
from girder.exceptions import RestException
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item

from dive_server.crud_annotation import RevisionLogItem
from dive_utils import constants, types
from dive_utils.scoring import SCORING_RESULT_META

# Enough for the cross-dataset listing without paging.
ALL_RESULTS_LIMIT = 200


def _auxiliary_folder(folder: types.GirderModel) -> Optional[types.GirderModel]:
    return Folder().findOne(
        {
            'parentId': folder['_id'],
            'parentCollection': 'folder',
            'name': constants.AuxiliaryFolderName,
        }
    )


def _isoformat(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _dataset_id_of_item(item: types.GirderModel) -> str:
    """The dataset whose auxiliary folder holds the result item."""
    auxiliary = Folder().load(item['folderId'], force=True)
    return str(auxiliary['parentId']) if auxiliary else ''


def _summary_from_item(item: types.GirderModel, dataset_id: Optional[str] = None) -> Dict[str, Any]:
    meta = item['meta'][SCORING_RESULT_META]
    pairs = meta.get('pairs')
    if pairs is None and meta.get('computed') and meta.get('truth'):
        # Results written before a run scored a list of sequences
        pairs = [{'computed': meta['computed'], 'truth': meta['truth']}]
    return {
        'id': str(item['_id']),
        'datasetId': meta.get('datasetId') or dataset_id or _dataset_id_of_item(item),
        'created': meta.get('created') or _isoformat(item['created']),
        'title': meta.get('title') or item['name'],
        'pairs': pairs or [],
        'params': meta.get('params') or {},
        'headline': meta.get('headline') or {},
    }


def list_results(folder: types.GirderModel) -> List[Dict[str, Any]]:
    auxiliary = _auxiliary_folder(folder)
    if auxiliary is None:
        return []
    items = Item().find(
        {'folderId': auxiliary['_id'], f'meta.{SCORING_RESULT_META}': {'$exists': True}},
        sort=[('created', -1)],
    )
    return [_summary_from_item(item, str(folder['_id'])) for item in items]


def list_all_results(user: types.GirderUserModel) -> List[Dict[str, Any]]:
    """Every scoring result the user can read, newest first."""
    items = Item().findWithPermissions(
        {f'meta.{SCORING_RESULT_META}': {'$exists': True}},
        user=user,
        level=AccessType.READ,
        sort=[('created', -1)],
        limit=ALL_RESULTS_LIMIT,
    )
    return [_summary_from_item(item) for item in items]


def _verify_result_item(folder: types.GirderModel, item: types.GirderModel):
    auxiliary = _auxiliary_folder(folder)
    if (
        auxiliary is None
        or item['folderId'] != auxiliary['_id']
        or SCORING_RESULT_META not in (item.get('meta') or {})
    ):
        raise RestException('Scoring result not found in this dataset', code=404)


def load_result(folder: types.GirderModel, item: types.GirderModel) -> Dict[str, Any]:
    _verify_result_item(folder, item)
    file = next(Item().childFiles(item), None)
    if file is None:
        raise RestException('Scoring result has no file', code=404)
    content = b"".join(File().download(file, headers=False)())
    result = json.loads(content.decode('utf-8'))
    result['id'] = str(item['_id'])
    return result


def delete_result(folder: types.GirderModel, item: types.GirderModel):
    _verify_result_item(folder, item)
    Item().remove(item)


def source_options(folder: types.GirderModel) -> Dict[str, Any]:
    sets = [name for name in RevisionLogItem().sets(folder) if name]
    cursor, _ = RevisionLogItem().list(folder)
    revisions = []
    for entry in cursor:
        revision = {
            'revision': entry['revision'],
            'description': entry.get('description') or '',
            'created': _isoformat(entry.get('created')),
        }
        if entry.get('author_name'):
            revision['author'] = entry['author_name']
        if entry.get('set'):
            revision['set'] = entry['set']
        revisions.append(revision)
    return {'sets': sets, 'revisions': revisions, 'files': []}
