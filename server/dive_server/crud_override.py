from typing import Tuple

import cherrypy
from girder.constants import AccessType
from girder.models.folder import Folder
from girder.models.user import User

from dive_utils import types


def get_folders_shared_with_me_query(user: types.GirderUserModel, prefix: str = ''):
    return {
        '$and': [
            # Folders expicilty set public are hidden (can also be False or None)
            {'$nor': [{'public': True}]},
            # Find folders not owned by the current user
            {
                '$nor': [
                    {prefix + 'creatorId': {'$eq': user['_id']}},
                    {prefix + 'creatorId': {'$eq': None}},
                ]
            },
            # But where the current user, or one group it belongs, has been given explicit access
            {
                '$or': [
                    {
                        prefix
                        + 'access.users': {
                            '$elemMatch': {'id': user['_id'], 'level': {'$gte': AccessType.READ}}
                        }
                    },
                    {
                        prefix
                        + 'access.groups': {
                            '$elemMatch': {
                                'id': {'$in': user.get('groups', [])},
                                'level': {'$gte': AccessType.READ},
                            }
                        }
                    },
                ]
            },
        ]
    }


def get_only_root_folders_shared_with_me_pipeline(
    user: types.GirderUserModel,
):
    pipeline: list[dict] = []
    pipeline.append({'$match': get_folders_shared_with_me_query(user)})

    # Join parent folder to selected ones
    pipeline.append(
        {
            '$lookup': {
                'from': 'folder',
                'localField': 'parentId',
                'foreignField': '_id',
                'as': 'parent',
            }
        }
    )

    # Transform parent array as single object
    pipeline.append({'$unwind': {'path': '$parent', 'preserveNullAndEmptyArrays': True}})

    # Filter folders to show depending on parent
    pipeline.append(
        {
            '$match': {
                '$or': [
                    # Only show folders that have no parent
                    {'parent': None},
                    # Or whose parent is not shared to the user
                    {'$nor': [get_folders_shared_with_me_query(user, prefix='parent.')]},
                ]
            }
        }
    )

    return pipeline


def list_shared_folders(
    user: types.GirderUserModel,
    limit: int,
    offset: int,
    sortParams: Tuple[Tuple[str, int]],
    onlyNonAccessibles: bool = True,
):
    sort, sortDir = (sortParams or [['created', 1]])[0]
    if sort == 'type':
        sort = 'meta.annotate'

    if onlyNonAccessibles:
        pipeline = get_only_root_folders_shared_with_me_pipeline(user)
    else:
        pipeline = [{'$match': get_folders_shared_with_me_query(user)}]

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


def get_root_path_or_relative(user: types.GirderUserModel, folder: types.GirderModel):
    path_to_folder = Folder().parentsToRoot(folder, force=True, user=user)
    final_path = []

    for item in reversed(path_to_folder):
        if item['type'] == 'folder':
            if not Folder().hasAccess(item['object'], user, AccessType.READ):
                # If user can't read parent, set parent creator as root
                creator = User().findOne({'_id': item['object']['creatorId']})
                if creator:
                    creator = User().filter(creator, user)
                    final_path.append({'type': 'user', 'object': creator})
                break
            item['object'] = Folder().filter(item['object'], user)
            final_path.append(item)
        else:
            if item['type'] == 'user':
                item['object'] = User().filter(item['object'], user)
                final_path.append(item)
            break

    return list(reversed(final_path))
