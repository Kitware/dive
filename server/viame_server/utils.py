from girder.models.item import Item
from girder.models.folder import Folder


def get_or_create_auxiliary_folder(folder, user):
    return Folder().createFolder(folder, 'auxiliary', reuseExisting=True, creator=user)


def move_existing_result_to_auxiliary_folder(folder, user):
    auxiliary = get_or_create_auxiliary_folder(folder, user)

    existingResultItem = Item().findOne({
        "folderId": folder['_id'],
        "meta.folderId": str(folder['_id']),
        "meta.pipeline": {'$exists': True},
    })
    if existingResultItem:
        Item().move(existingResultItem, auxiliary)
