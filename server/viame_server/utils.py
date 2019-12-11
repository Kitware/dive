from girder.models.folder import Folder

def get_or_create_auxiliary_folder(item, user):
    containingFolder = list(Folder().findWithPermissions({"_id": item['folderId']}, user=user))[0]
    return Folder().createFolder(containingFolder, item['name']+'_data', reuseExisting=True, creator=user)
