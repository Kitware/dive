from contextlib import suppress
import os
from pathlib import Path
import shlex
import tempfile
import zipfile

from girder_client import GirderClient, HttpError
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.convert_video import resolve_annotation_fps
from dive_tasks.manager import patch_manager
from dive_tasks.viame_config import Config
from dive_utils import asbool, calibration_format, constants
from dive_utils.types import GirderModel


@app.task(bind=True, acks_late=True, ignore_result=True)
def convert_calibration(self: Task, itemId: str):
    """
    Convert a calibrationFile item to a JSON camera-rig in a separate Girder item
    marked jsonCalibrationFile for display.
    """
    conf = Config()
    conf.require_viame_install()
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    convert_tool = conf.viame_install_path / 'configs' / 'convert_cam_format.py'

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        item: GirderModel = gc.getItem(itemId)
        folder_id = str(item.get('folderId'))
        folder = gc.getFolder(folder_id)
        multi_cam = (folder.get('meta') or {}).get(constants.MultiCamMarker) or {}
        if str(multi_cam.get(constants.CalibrationItemIdMarker)) != str(itemId):
            manager.write('Calibration source was replaced; skipping stale conversion job.\n')
            return

        files = list(gc.listFile(itemId))
        source_file = next(
            (f for f in files if constants.stereoCalibrationRegex.search(f['name'])),
            None,
        )
        if source_file is None:
            manager.write('No convertible calibration file found in item; skipping.\n')
            return

        manager.updateStatus(JobStatus.FETCHING_INPUT)
        gc.downloadItem(itemId, _working_directory_path, name=item.get('name'))
        input_path = _working_directory_path / source_file['name']
        file_bytes = input_path.read_bytes()
        if source_file['name'].lower().endswith('.json'):
            if calibration_format.calibration_upload_is_final_json(source_file['name'], file_bytes):
                manager.write('Source calibration is already JSON; skipping conversion.\n')
                return
            input_path = calibration_format.prepare_conversion_input_path(
                input_path,
                file_bytes,
                _working_directory_path,
            )
        output_path = input_path.with_suffix('.json')

        manager.updateStatus(JobStatus.RUNNING)
        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            "python",
            shlex.quote(str(convert_tool)),
            shlex.quote(str(input_path)),
            shlex.quote(str(output_path)),
        ]
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': str(_working_directory_path),
            'env': conf.gpu_process_env,
        }
        try:
            utils.stream_subprocess(self, context, manager, popen_kwargs)
        except Exception as exc:
            error_msg = str(exc) or 'Calibration conversion failed'
            updated_multi_cam = dict(multi_cam)
            updated_multi_cam[constants.CalibrationConversionErrorMarker] = error_msg
            gc.addMetadataToFolder(
                folder_id,
                {constants.MultiCamMarker: updated_multi_cam},
            )
            raise

        if not output_path.exists() or not output_path.stat().st_size:
            error_msg = 'Calibration conversion produced no JSON output'
            updated_multi_cam = dict(multi_cam)
            updated_multi_cam[constants.CalibrationConversionErrorMarker] = error_msg
            gc.addMetadataToFolder(
                folder_id,
                {constants.MultiCamMarker: updated_multi_cam},
            )
            raise RuntimeError(error_msg)

        folder = gc.getFolder(folder_id)
        multi_cam = (folder.get('meta') or {}).get(constants.MultiCamMarker) or {}
        if str(multi_cam.get(constants.CalibrationItemIdMarker)) != str(itemId):
            manager.write('Calibration source was replaced during conversion; discarding output.\n')
            return

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        json_name = output_path.name
        gc.upload(str(output_path), folder_id)
        json_items = sorted(
            gc.listItem(folder_id, name=json_name),
            key=lambda existing: existing.get('created', ''),
        )
        if not json_items:
            raise RuntimeError('Failed to create calibration JSON item')
        json_item = json_items[-1]
        json_item_id = str(json_item['_id'])
        gc.addMetadataToItem(
            json_item_id,
            {
                constants.JsonCalibrationFileMarker: 'true',
                constants.CalibrationFileMarker: False,
            },
        )

        folder = gc.getFolder(folder_id)
        multi_cam = (folder.get('meta') or {}).get(constants.MultiCamMarker) or {}
        if str(multi_cam.get(constants.CalibrationItemIdMarker)) != str(itemId):
            manager.write(
                'Calibration source was replaced before linking JSON; discarding output.\n'
            )
            gc.delete(f'item/{json_item_id}')
            return

        updated_multi_cam = dict(multi_cam)
        updated_multi_cam.setdefault(constants.CalibrationItemIdMarker, str(itemId))
        updated_multi_cam[constants.JsonCalibrationItemIdMarker] = json_item_id
        updated_multi_cam.setdefault(
            constants.CalibrationOriginalNameMarker,
            source_file['name'],
        )
        updated_multi_cam.pop(constants.CalibrationConversionErrorMarker, None)
        gc.addMetadataToFolder(
            folder_id,
            {constants.MultiCamMarker: updated_multi_cam},
        )

        for existing_item in gc.listItem(folder_id):
            existing_id = str(existing_item['_id'])
            if existing_id in {json_item_id, str(itemId)}:
                continue
            existing_meta = existing_item.get('meta') or {}
            if asbool(existing_meta.get(constants.JsonCalibrationFileMarker)):
                gc.delete(f"item/{existing_id}")


@app.task(bind=True, acks_late=True)
def convert_images(self: Task, folderId, user_id: str, user_login: str):
    """
    Ensures that all images in a folder are in a web friendly format (png or jpeg).

    If conversions succeeds for an image, it will replace the image with an image
    of the same name, but in a web friendly extension.

    Returns the number of images successfully converted.
    """
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    items_to_convert = [
        item
        for item in gc.listItem(folderId)
        if (
            constants.imageRegex.search(item["name"])
            and not constants.safeImageRegex.search(item["name"])
        )
    ]

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        working_directory_path = Path(_working_directory)
        images_path = utils.make_directory(working_directory_path / 'images')

        for item in items_to_convert:
            # Assumes 1 file per item
            gc.downloadItem(item["_id"], images_path, item["name"])

            item_path = images_path / item["name"]
            new_item_path = images_path / ".".join([*item["name"].split(".")[:-1], "png"])
            command = ["ffmpeg", "-i", str(item_path), str(new_item_path)]
            utils.stream_subprocess(self, context, manager, {'args': command})
            gc.uploadFileToFolder(folderId, new_item_path)
            gc.delete(f"item/{str(item['_id'])}")

        gc.addMetadataToFolder(
            str(folderId),
            {
                "annotate": True,  # mark the parent folder as able to annotate.
                constants.FPSMarker: resolve_annotation_fps(gc, folderId),
            },
        )


@app.task(bind=True, acks_late=True)
def convert_large_images(self: Task, folderId, user_id: str, user_login: str):
    """
    Converts all images in the folder to large images

    This is typically done if the images are >8k W or L resolution

    Returns the number of images successfully converted.
    """
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    items_to_convert = [
        item for item in gc.listItem(folderId) if (constants.safeImageRegex.search(item["name"]))
    ]
    for item in items_to_convert:
        # Assumes 1 file per item
        try:
            # Does it already have tiles?
            gc.get(f'item/{item["_id"]}/tiles')
            manager.write(f'Skipping {item["name"]}, already a large image\n')
            continue
        except HttpError as e:
            # Safely parse JSON if possible
            message = ""
            try:
                message = e.response.json().get("message", "")
            except Exception:
                pass  # non-JSON response, leave message empty
            # This is the Girder message when no large image exists
            if e.status == 400 and message == "No large image file in this item.":
                manager.write(f'Converting {item["name"]} to large image\n')
                gc.post(f'item/{item["_id"]}/tiles')
            else:
                # Re-raise unexpected errors to fail the job
                raise
    gc.addMetadataToFolder(
        str(folderId),
        {"type": constants.LargeImageType},  # mark the parent folder as able to annotate.
    )


@app.task(bind=True, acks_late=True, ignore_result=True)
def extract_zip(
    self: Task,
    folderId: str,
    itemId: str,
    user_id: str,
    user_login: str,
    additive: bool = False,
):
    """
    Discovery logic:
    * Find all folders that have at least one child file (potential datasets)
    * Exclude folders which are sub-folders of previously discovered folders
      because datasets cannot be nested in other datasets
    """
    context: dict = {}
    gc: GirderClient = self.girder_client
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        item: GirderModel = gc.getItem(itemId)
        file_name = str(_working_directory_path / item['name'])
        manager.write(f'Fetching input from {itemId} to {file_name}...\n')
        gc.downloadItem(itemId, _working_directory, item["name"])
        discovered_folders = {}
        with zipfile.ZipFile(file_name, 'r') as zipObj:
            listOfFileNames = zipObj.namelist()
            sum_file_size = sum([data.file_size for data in zipObj.filelist])
            sum_compress_size = sum([data.compress_size for data in zipObj.filelist])
            ratio = sum_file_size / sum_compress_size
            if ratio > 600:
                manager.write(f"Compression ratio is exceedingly high at {ratio}\n\
                    Please contact an admin at viame-web@kitware.com if this is a valid zip file")
                raise Exception("High Compression Ratio for Zip File")

            multicam_export_roots = {
                os.path.dirname(fileName)
                for fileName in listOfFileNames
                if os.path.basename(fileName) == constants.MultiCamJsonFileName
                and not fileName.endswith(os.path.sep)
            }

            for fileName in listOfFileNames:
                folderName = os.path.dirname(fileName)
                parentName = os.path.dirname(folderName)
                if parentName in discovered_folders and folderName != '':
                    discovered_folders[folderName] = 'ignored'
                    # Nested single-camera exports stay skipped; multicam camera trees must extract.
                    if not utils.is_path_under_multicam_export(folderName, multicam_export_roots):
                        continue
                if fileName.endswith(os.path.sep):
                    continue
                if folderName not in discovered_folders:
                    discovered_folders[folderName] = 'unstructured'
                if constants.metaRegex.search(os.path.basename(fileName)):
                    if folderName in multicam_export_roots:
                        discovered_folders[folderName] = 'multicam'
                    else:
                        discovered_folders[folderName] = 'dataset'
                if fileName.endswith('.zip'):
                    raise Exception("Nested Zip Files are invalid")
                manager.write(f"Extracting: {fileName}\n")
                zipObj.extract(fileName, f'{_working_directory}')

        # remove the zip file so it isn't uploaded back to the folder
        os.remove(file_name)
        # Create source folder and move zip file there
        created_folder = gc.createFolder(
            folderId,
            constants.SourceFolderName,
            reuseExisting=True,
        )
        gc.sendRestRequest(
            "PUT",
            f"/item/{str(item['_id'])}?folderId={str(created_folder['_id'])}",
        )
        # Only make subfolders if more than 1 discovered folder exists
        make_subfolders = (
            len(discovered_folders) - list(discovered_folders.values()).count('ignored')
        ) > 1
        for folderName, folderType in discovered_folders.items():
            subFolderName = folderName if make_subfolders else ''
            try:
                if folderType == 'unstructured':
                    utils.upload_zipped_flat_media_files(
                        gc,
                        manager,
                        folderId,
                        _working_directory_path / folderName,
                        subFolderName,
                        additive,
                    )
                elif folderType == 'multicam':
                    utils.upload_exported_multicam_zipped_dataset(
                        gc,
                        manager,
                        folderId,
                        _working_directory_path / folderName,
                        subFolderName,
                        additive,
                    )
                elif folderType == 'dataset':
                    utils.upload_exported_zipped_dataset(
                        gc,
                        manager,
                        folderId,
                        _working_directory_path / folderName,
                        subFolderName,
                        additive,
                    )
                else:
                    manager.write(f'Ignoring {folderName}\n')
            except utils.MalformedExportedConfigurationError:
                gc.delete(f'item/{itemId}')
                raise

        if make_subfolders:
            gc.sendRestRequest(
                "DELETE",
                f"folder/{folderId}/metadata",
                json=[constants.TypeMarker, constants.FPSMarker, constants.DatasetMarker],
            )
