import logging
import os
from pathlib import Path
import shutil
from typing import List
from urllib import request
from urllib.parse import urlparse
import zipfile

import gdown
from gdown.parse_url import is_google_drive_url, parse_url
from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.manager import patch_manager
from dive_tasks.pipeline_discovery import discover_configs
from dive_tasks.viame_config import EMPTY_JOB_SCHEMA, Config

logger = logging.getLogger(__name__)

# https://github.com/VIAME/VIAME/blob/master/cmake/download_viame_addons.csv
UPGRADE_JOB_DEFAULT_URLS: List[str] = [
    'https://viame.kitware.com/api/v1/item/627b145487bad2e19a4c4697/download',  # HabCam
    'https://viame.kitware.com/api/v1/item/627b32b1994809b024f207a7/download',  # SEFSC
    'https://viame.kitware.com/api/v1/item/627b3289ea630db5587b577d/download',  # SWFSC-PengHead
    'https://viame.kitware.com/api/v1/item/627b326fea630db5587b577b/download',  # Motion
    'https://viame.kitware.com/api/v1/item/627b326cc4da86e2cd3abb5b/download',  # EM Tuna
    'https://viame.kitware.com/api/v1/item/627b3282c4da86e2cd3abb5d/download',  # MOUSS
    'https://viame.kitware.com/api/v1/item/615bc7aa7e5c13a5bb9af7a7/download',  # Aerial Penguin
    'https://viame.kitware.com/api/v1/item/629807c192adc2f0ecfa5b54/download',  # Sea Lion
]


def _normalize_google_drive_url(url: str) -> str:
    """Strip a leading www. so gdown recognizes common pasted Drive links."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith('www.'):
        return parsed._replace(netloc=host[4:]).geturl()
    return url


def is_google_drive_addon_url(url: str) -> bool:
    """Return True if url is a Google Drive link (after normalizing www.)."""
    return is_google_drive_url(_normalize_google_drive_url(url))


def download_google_drive_zip(url: str, dest: Path) -> None:
    """Download a publicly shared Google Drive zip to dest via gdown."""
    gdown.download(url=_normalize_google_drive_url(url), output=str(dest), quiet=True)


def _addon_zip_path_for_url(addon_url: str, addon_zip_dir: Path) -> Path:
    normalized = _normalize_google_drive_url(addon_url)
    if is_google_drive_url(normalized):
        file_id, _ = parse_url(normalized)
        if file_id:
            return addon_zip_dir / f'gdrive_{file_id}.zip'
    download_name = urlparse(addon_url).path.replace(os.path.sep, '_')
    return addon_zip_dir / f'{download_name}.zip'


@app.task(bind=True, acks_late=True, ignore_result=True)
def upgrade_pipelines(
    self: Task,
    urls: List[str] = UPGRADE_JOB_DEFAULT_URLS,
    force: bool = False,
):
    """Install addons from zip files over HTTP (including Google Drive share links)"""
    conf = Config()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    # zipfiles to extract after download is complete
    addons_to_update_update: List[Path] = []

    for addon in urls:
        zipfile_path = _addon_zip_path_for_url(addon, conf.addon_zip_path)
        had_existing_zip = zipfile_path.exists()
        try:
            if not had_existing_zip or force:
                manager.write(f'Downloading {addon} to {zipfile_path}\n')
                if is_google_drive_addon_url(addon):
                    download_google_drive_zip(addon, zipfile_path)
                else:
                    request.urlretrieve(addon, filename=zipfile_path)
            else:
                manager.write(f'Skipping download of {zipfile_path}\n')
            addons_to_update_update.append(zipfile_path)
        except Exception as exc:
            logger.exception('Failed to download addon %s', addon)
            manager.write(f'Failed to download {addon}: {exc}\nSkipping.\n')
            if zipfile_path.exists() and not had_existing_zip:
                zipfile_path.unlink(missing_ok=True)
        if utils.check_canceled(self, context, force=False):
            manager.updateStatus(JobStatus.CANCELED)
            return

    # remove and recreate the existing addon pipeline directory
    shutil.rmtree(conf.addon_extracted_path)
    # Seed base pipelines from the VIAME image when available (GPU workers only).
    if conf.viame_pipeline_path.exists():
        shutil.copytree(conf.viame_pipeline_path, conf.get_extracted_pipeline_path(missing_ok=True))
    # Extract zipfiles over newly copied files.  Right now the zip archives
    # MUST contain the pipeline subdir (e.g. configs/pipelines) in their
    # internal structure.
    for zipfile_path in addons_to_update_update:
        manager.write(f'Extracting {zipfile_path} to {str(conf.addon_extracted_path)}\n')
        z = zipfile.ZipFile(zipfile_path)
        z.extractall(conf.addon_extracted_path)

    if utils.check_canceled(self, context):
        # Remove everything
        shutil.rmtree(conf.addon_extracted_path)
        manager.updateStatus(JobStatus.CANCELED)
        gc.put('dive_configuration/static_pipeline_configs', json=EMPTY_JOB_SCHEMA)
        return

    # finally, crawl the new files and report results
    summary = discover_configs(conf.get_extracted_pipeline_path())
    manager.write(str(summary))
    gc.put('dive_configuration/static_pipeline_configs', json=summary)
    # get a list of files in the zip directory for the installed configuration listing
    downloaded = []

    # Iterate directory
    for path in os.listdir(conf.addon_zip_path):
        # check if current path is a file
        if os.path.isfile(os.path.join(conf.addon_zip_path, path)):
            downloaded.append(path)
    print('Downloaded Files')
    print(downloaded)
    gc.put('dive_configuration/installed_addons', json={'downloaded': downloaded})
