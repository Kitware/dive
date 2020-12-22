import os
import shutil
from pathlib import Path
from subprocess import Popen, TimeoutExpired
from tempfile import mktemp
from typing import IO, Optional, Tuple

from girder_worker.task import Task


def read_and_close_process_outputs(
    process: Popen,
    task: Task,
    stdout_file: Optional[IO] = None,
    stderr_file: Optional[IO] = None,
) -> Tuple[str, str]:
    stdout: str = ""
    stderr: str = ""

    while not task.canceled and process.poll() is None:
        try:
            process.wait(timeout=20)
        except TimeoutExpired:
            pass

    if task.canceled:
        process.kill()
        return ("", "")

    if stdout_file is not None:
        stdout_file.seek(0)
        stdout = stdout_file.read().decode()
        stdout_file.close()

    if stderr_file is not None:
        stderr_file.seek(0)
        stderr = stderr_file.read().decode()
        stderr_file.close()

    return (stdout, stderr)


def organize_folder_for_training(
    root_training_dir: Path, data_dir: Path, downloaded_groundtruth: Path
):
    """
    Organize directory downloaded from girder into a structure compatible with Viame.

    Relevant documentation:
    https://viame.readthedocs.io/en/latest/section_links/object_detector_training.html
    """

    if downloaded_groundtruth.is_dir():
        files = list(downloaded_groundtruth.glob("*.csv"))

        if not files:
            raise Exception("No csv groundtruth files found.")

        groundtruth_file = files[0]
        temp_file = downloaded_groundtruth.parent / mktemp()

        # Replace directory with file of same name
        shutil.copyfile(groundtruth_file, temp_file)
        shutil.rmtree(downloaded_groundtruth)
        shutil.move(str(temp_file), downloaded_groundtruth)

    groundtruth = data_dir / "groundtruth.csv"
    shutil.move(str(downloaded_groundtruth), groundtruth)

    return groundtruth


def get_source_video(input_path: Path, folderId: str, girder_client):
    validVideoFormats = [".mp4", ".avi", ".mov", ".mpg"]
    folder_contents = girder_client.listItem(folderId)
    for item in folder_contents:
        file_name = os.path.join(input_path, item.get("name"))
        extension = os.path.splitext(file_name)[1].lower()
        print(extension)
        if item.get("meta", {}).get("codec") is None and extension in validVideoFormats:
            return file_name
    return None
