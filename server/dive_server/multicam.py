from dive_utils.models import MultiCamArgs
from girder.models.folder import Folder
from girder.models.item import Item
from dive_utils.constants import calibrationRegEx


def process_multicam_folder(folder, args: MultiCamArgs):
    output_meta = {
        'cameras': {},
        'display': args.defaultDisplay,
    }
    for key in args.folderList.keys():
        upload_folder = args.folderList[key]
        girder_folder = Folder().createFolder(folder, str(key))
        for item in upload_folder:
            print(f'Trying to find item with filename {item}')
            print(item)
            file_item = Item().findOne({'folderId': folder['_id'], 'name': item})
            print(file_item)
            Item().move(file_item, girder_folder)
        output_meta['cameras'][key] = {
            'originalBaseId': girder_folder['_id'],
            'type': 'image-sequence',
        }
    calibration_file = Item().findOne(
        {'parentId': folder['_id'], "lowerName": args.calibrationFile}
    )
    if calibration_file is not None:
        output_meta['calibration'] = calibration_file['_id']
    return output_meta
