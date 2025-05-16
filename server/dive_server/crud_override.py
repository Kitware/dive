import cherrypy

from typing import Tuple

from dive_utils import types

from girder.models.folder import Folder
from girder.models.user import User
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
    if sort == 'type':
        sort = 'meta.annotate'

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


def get_root_path_or_relative(
    user: types.GirderUserModel,
    folder: types.GirderModel
):
    path_to_folder = Folder().parentsToRoot(folder, force=True, user=user)
    final_path = []
    
    for item in reversed(path_to_folder):
        if item['type'] == 'folder':
            if not Folder().hasAccess(item['object'], user, AccessType.READ):
                # If user can't read parent, set parent creator as root
                creator = User().findOne({'_id': item['object']['creatorId']})
                if creator:
                    creator = User().filter(creator, user)
                    final_path.append({
                        'type': 'user',
                        'object': creator
                    })
                break
            item['object'] = Folder().filter(item['object'], user)
            final_path.append(item)
        else:
            if item['type'] == 'user':
                item['object'] = User().filter(item['object'], user)
                final_path.append(item)
            break

    return list(reversed(final_path))