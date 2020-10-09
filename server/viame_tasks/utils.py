import os
import shutil
from pathlib import Path
from tempfile import mktemp
from subprocess import Popen

from typing import Optional, Tuple, IO


def read_and_close_process_outputs(
    process: Popen,
    stdout_file: Optional[IO] = None,
    stderr_file: Optional[IO] = None,
) -> Tuple[str, str]:
    stdout: str = ""
    stderr: str = ""

    process.wait()
    if stdout_file is not None:
        stdout_file.seek(0)
        stdout = str(stdout_file.read())
        stdout_file.close()

    if stderr_file is not None:
        stderr_file.seek(0)
        stderr = str(stderr_file.read())
        stderr_file.close()

    return (stdout, stderr)


def trained_pipeline_folder():
    """
    Returns the folder designated for trained pipeline output.

    Folder is created if it does not already exist.
    """
    folder = os.environ.get("VIAME_TRAINED_PIPELINES_PATH", None)
    if not folder:
        print("Environment Variable VIAME_TRAINED_PIPELINES_PATH not set!")
        return None

    return Path(folder)


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
            row = [c.strip() for c in line.split(",")]

            # Confidence pairs start at the 9th index
            # 9th index is label, 10th is confidence, 11th is another label, etc.
            for label in row[9::2]:
                labels.add(label)

    with open(root_training_dir / "labels.txt", "w") as labels_file:
        label_lines = [f"{label}\n" for label in labels]
        labels_file.writelines(label_lines)
