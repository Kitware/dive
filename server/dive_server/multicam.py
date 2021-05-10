from dive_utils.types import MultiCamArgs
from girder.models.folder import Folder
from girder.models.item import Item
from dive_utils.constants import calibrationRegEx


def process_multicam_folder(folderId, args: MultiCamArgs):
    all_items = list(Folder().childItems(folderId))
    output_meta = {
        'cameras': {},
        'display': args.defaultDisplay,
    }
    for key in args.folderList.keys():
        upload_folder = args.folderList[key]
        girder_folder = Folder().createFolder(folderId, str(key))
        for item in upload_folder:
            file_item = Item().findOne({'parentId': folderId, 'name': item})
            Item().move(file_item, girder_folder)
        output_meta['cameras'][key] = {
            'originalBaseId': girder_folder['_id'],
            'type': 'image-sequence',
        }
    calibration_file = Folder().findOne(
        folderId,
        filters={"lowerName": {"$regex": calibrationRegEx}},
    )
    if calibration_file is not None:
        output_meta['calibration'] = calibration_file['_id']
