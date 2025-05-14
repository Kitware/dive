import cherrypy

from typing import Tuple

from dive_utils import types

from girder.models.folder import Folder
from girder.constants import AccessType

def get_folders_shared_with_me_query(
    user: types.GirderUserModel,
):
    query = {
        '$and': [
            Folder().permissionClauses(user=user, level=AccessType.READ),
            {
                # Find folders not owned by the current user
                '$nor': [{'creatorId': {'$eq': user['_id']}}, {'creatorId': {'$eq': None}}]
            },
            {
                # But where the current user has been given explicit access
                # Implicit public folders should not be considered "shared"
                'access.users': {'$elemMatch': {'id': user['_id']}}
            },
        ]
    }

    return query


def get_only_root_folders_shared_with_me_pipeline(
    user: types.GirderUserModel,
):
    pipeline: list[dict] = []
    pipeline.append({
        '$match': get_folders_shared_with_me_query(user)
    })

    # Join parent folder to selected ones
    pipeline.append({
        '$lookup': {
            'from': 'folder',
            'localField': 'parentId',
            'foreignField': '_id',
            'as': 'parent'
        }
    })

    # Transform parent array as single object
    pipeline.append({
        '$unwind': {
            'path': '$parent',
            'preserveNullAndEmptyArrays': True
        }
    })

    # Select only folders whose parents are not visible to user
    pipeline.append({
        '$match': {
            '$or': [
                {'$nor': [Folder().permissionClauses(user=user, level=AccessType.READ, prefix='parent.')]},
                {'parent': None}
            ]
        }
    })

    return pipeline


def list_shared_folders(
    user: types.GirderUserModel,
    limit: int,
    offset: int,
    sortParams: Tuple[Tuple[str, int]],
    onlyNonAccessibles: bool = True
):
    sort, sortDir = (sortParams or [['created', 1]])[0]

    if onlyNonAccessibles:
        pipeline = get_only_root_folders_shared_with_me_pipeline(user)
    else:
        pipeline = [{
            '$match': get_folders_shared_with_me_query(user)
        }]

    # based on https://stackoverflow.com/a/49483919
    pipeline += [
        {
            '$facet': {
                'results': [
                    {'$sort': {sort: sortDir}},
                    {'$skip': offset},
                    {'$limit': limit},
                    {
                        '$lookup': {
                            'from': 'user',
                            'localField': 'creatorId',
                            'foreignField': '_id',
                            'as': 'ownerLogin',
                        },
                    },
                    {'$set': {'ownerLogin': {'$first': '$ownerLogin'}}},
                    {'$set': {'ownerLogin': '$ownerLogin.login'}},
                ],
                "totalCount": [{'$count': 'count'}],
            },
        },
    ]

    response = next(Folder().collection.aggregate(pipeline))
    total = response['totalCount'][0]['count'] if len(response['results']) > 0 else 0
    cherrypy.response.headers['Girder-Total-Count'] = total
    return [Folder().filter(doc, additionalKeys=['ownerLogin']) for doc in response['results']]