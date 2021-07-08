from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.upload import Upload
from girder.models.user import User

from dive_server.utils import get_annotation_csv_generator
from dive_utils.constants import ViameDataFolderName
from dive_utils.types import GirderModel

TrainingOutputFolderName = "VIAME Training Results"


def training_output_folder(user: User):
    """Ensure that the user has a training results folder."""
    viameFolder = Folder().createFolder(
        user,
        ViameDataFolderName,
        description="VIAME data storage.",
        parentType="user",
        public=False,
        creator=user,
        reuseExisting=True,
    )

    return Folder().createFolder(
        viameFolder,
        TrainingOutputFolderName,
        description="Results from VIAME model training are placed here.",
        public=False,
        creator=user,
        reuseExisting=True,
    )


def ensure_csv_detections_file(folder: Folder, detection_item: Item, user: User) -> GirderModel:
    """
    Ensures that the detection item has a file which is a csv.
    Attach the newly created .csv to the existing detection_item.
    :returns: the file document.

    TODO: move this to the training job code instead of keeping it
    in the request thread
    """
    filename, gen = get_annotation_csv_generator(folder, user, excludeBelowThreshold=True)
    csv_bytes = ("".join([line for line in gen()])).encode()
    new_file = File().createFile(
        user,
        detection_item,
        filename,
        len(csv_bytes),
        Assetstore().getCurrent(),
        reuseExisting=True,
    )
    upload = Upload().createUploadToFile(new_file, user, len(csv_bytes))
    new_file = Upload().handleChunk(upload, csv_bytes)
    return new_file
