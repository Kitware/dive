from girder.models.folder import Folder
from girder.models.item import Item
from girder.utility.mail_utils import renderTemplate, sendMail
from girder.models.setting import Setting
from girder.settings import SettingKey

from dive_utils.constants import (
    DatasetMarker,
    DefaultVideoFPS,
    FPSMarker,
    ImageSequenceType,
    csvRegex,
)


def send_new_user_email(event):
    info = event.info
    email = info.get('email')
    brandName = Setting().get(SettingKey.BRAND_NAME)
    rendered = renderTemplate('welcome.mako')
    sendMail(f'Welcome to {brandName}', rendered, [email])


def check_existing_annotations(event):
    """
    function for appending the appropriate metadata
    to no-copy import data
    """
    info = event.info
    objectType = info.get("type")
    importPath = info.get("importPath")

    if not importPath or not objectType or objectType != "item":
        return

    if csvRegex.search(importPath):
        # Update file metadata
        item = Item().findOne({"_id": info["id"]})
        item["meta"].update({"detection": str(item["folderId"])})
        Item().save(item)

        # Update metadata of parent folder
        # FPS is hardcoded for now
        folder = Folder().findOne({"_id": item["folderId"]})
        folder["meta"].update(
            {"type": ImageSequenceType, FPSMarker: DefaultVideoFPS, DatasetMarker: True}
        )
        Folder().save(folder)
