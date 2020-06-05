import shutil
from pathlib import Path


def organize_folder_for_training(
    root_training_dir: Path, data_dir: Path, groundtruth_path: Path
):
    """
    Organize directory downloaded from girder into a structure compatible with Viame.

    Relevant documentation:
    https://viame.readthedocs.io/en/latest/section_links/object_detector_training.html
    """

    if groundtruth_path.is_dir():
        groundtruth_dir = groundtruth_path
        files = list(groundtruth_dir.glob("*.csv"))

        if not files:
            raise Exception("No csv groundtruth files found.")

        groundtruth_file = files[0]
        groundtruth_path = data_dir / "groundtruth.csv"
        shutil.copyfile(groundtruth_file, groundtruth_path)
        shutil.rmtree(groundtruth_dir)

    labels = set()
    with open(groundtruth_path, 'r') as groundtruth_infile:
        for line in groundtruth_infile.readlines():
            row = [c.strip() for c in line.split(",")]

            # Confidence pairs start at the 9th index
            # 9th index is label, 10th is confidence, 11th is another label, etc.
            for label in row[9::2]:
                labels.add(label)

    with open(root_training_dir / "labels.txt", "w") as labels_file:
        labels_file.writelines(labels)
