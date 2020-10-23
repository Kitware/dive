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

    # Generate labels.txt
    labels = set()
    with open(groundtruth, 'r') as groundtruth_infile:
        for line in groundtruth_infile.readlines():
            if not line.strip().startswith('#'):
                row = [c.strip() for c in line.split(",")]

                # Confidence pairs start at the 9th index
                # 9th index is label, 10th is confidence, 11th is another label, etc.
                for label in row[9::2]:
                    labels.add(label)

    with open(root_training_dir / "labels.txt", "w") as labels_file:
        label_lines = [f"{label}\n" for label in labels]
        labels_file.writelines(label_lines)
