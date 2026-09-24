from contextlib import suppress
from pathlib import Path
import shlex
import tempfile
from typing import Dict, List, Tuple

from girder_client import GirderClient
from girder_worker.app import app
from girder_worker.task import Task
from girder_worker.utils import JobManager, JobStatus

from dive_tasks import utils
from dive_tasks.manager import patch_manager
from dive_tasks.viame_config import Config
from dive_utils import constants
from dive_utils.types import ExportTrainedPipelineJob, TrainingJob


@app.task(bind=True, acks_late=True, ignore_results=True)
def export_trained_pipeline(self: Task, params: ExportTrainedPipelineJob):
    conf = Config()
    conf.require_viame_install()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    utils.authenticate_urllib(gc)
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    # Extract params
    input_folder_id = params["input_folder"]
    output_folder_id = params["output_folder"]
    output_name = params["output_name"]

    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        trained_pipeline_path = utils.make_directory(_working_directory_path / 'trained_pipeline')
        output_path = utils.make_directory(_working_directory_path / 'output')
        onnx_path = output_path / output_name
        convert_to_onnx_pipeline_path = conf.viame_pipeline_path / "convert_model_to_onnx.pipe"

        gc.downloadFolderRecursive(input_folder_id, str(trained_pipeline_path))
        extensions = ['*.weights', '*.ckpt', '*.pth']
        model_file = None

        for ext in extensions:
            found_files = list(trained_pipeline_path.glob(ext))
            if found_files:
                model_file = found_files[0]
                break

        if not model_file:
            raise FileNotFoundError(f"No weights path ({extensions}) found.")

        # Convert pipeline to ONNX
        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
            f"viame run {shlex.quote(str(convert_to_onnx_pipeline_path))}",
            f"-s onnx_convert:model_path={shlex.quote(str(model_file))}",
            f"-s onnx_convert:onnx_model_prefix={shlex.quote(str(onnx_path))}",
        ]

        manager.updateStatus(JobStatus.RUNNING)
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': output_path,
            'env': conf.gpu_process_env,
        }
        utils.stream_subprocess(self, context, manager, popen_kwargs)

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        gc.uploadFileToFolder(output_folder_id, onnx_path)


def write_training_lists(
    input_path: Path, prefix: str, entries: List[Tuple[Path, Path]]
) -> Tuple[Path, Path]:
    """Write matching data and truth lists, one absolute path per line."""
    data_list_path = input_path / f"{prefix}_folder_list.txt"
    truth_list_path = input_path / f"{prefix}_truth_list.txt"
    with open(data_list_path, "w+") as data_list, open(truth_list_path, "w+") as truth_list:
        for folder_path, groundtruth_path in entries:
            data_list.write(f"{folder_path}\n")
            truth_list.write(f"{groundtruth_path}\n")
    return data_list_path, truth_list_path


@app.task(bind=True, acks_late=True, ignore_result=True)
def train_pipeline(self: Task, params: TrainingJob):
    """Train a pipeline by making a call to viame train"""
    conf = Config()
    conf.require_viame_install()
    context: dict = {}
    manager: JobManager = patch_manager(self.job_manager)
    if utils.check_canceled(self, context):
        manager.updateStatus(JobStatus.CANCELED)
        return

    gc: GirderClient = self.girder_client
    utils.authenticate_urllib(gc)
    manager.updateStatus(JobStatus.FETCHING_INPUT)

    # Extract params
    results_folder_id = params['results_folder_id']
    dataset_input_list = params['dataset_input_list']
    dataset_splits: Dict[str, str] = params.get('dataset_splits') or {}
    pipeline_name = params['pipeline_name']
    config = params['config']
    annotated_frames_only = params['annotated_frames_only']
    label_text = params['label_txt']
    model = params.get('model', None)
    # Normalize: model can arrive as a list of [key, value] pairs from some serialization paths
    if model is not None and isinstance(model, list):
        model = dict(model)
    force_transcoded = params.get('force_transcoded', False)

    pipeline_base_path = Path(conf.get_extracted_pipeline_path())
    config_file = pipeline_base_path / config
    # (input folder, ground truth file) pairs per training split
    split_inputs: Dict[str, List[Tuple[Path, Path]]] = {
        split: [] for split in constants.TrainingSplits
    }
    # root_data_dir is the directory passed to `viame train`
    with tempfile.TemporaryDirectory() as _working_directory, suppress(utils.CanceledError):
        _working_directory_path = Path(_working_directory)
        input_path = utils.make_directory(_working_directory_path / 'input')
        output_path = utils.make_directory(_working_directory_path / 'output')

        for source_folder_id, revision in dataset_input_list:
            download_path = utils.make_directory(input_path / source_folder_id)
            groundtruth_path = download_path / 'groundtruth.csv'
            # Download groundtruth item
            utils.download_revision_csv(gc, source_folder_id, revision, groundtruth_path)
            # Download input media
            input_media_list, input_type = utils.download_source_media(
                gc, source_folder_id, download_path, force_transcoded
            )
            if input_type == constants.VideoType:
                download_path = Path(input_media_list[0])
            # Set media source location
            split = dataset_splits.get(source_folder_id, 'train')
            if split not in split_inputs:
                split = 'train'
            split_inputs[split].append((download_path, groundtruth_path))

        if not split_inputs['train']:
            raise RuntimeError(
                'Every selected dataset is labeled validation or test; '
                'at least one must be available for training'
            )
        input_folder_file_list, ground_truth_file_list = write_training_lists(
            input_path, 'input', split_inputs['train']
        )

        training_results_path = utils.make_directory(output_path / "category_models")

        command = [
            f". {shlex.quote(str(conf.viame_setup_script))} &&",
            f"KWIVER_DEFAULT_LOG_LEVEL={shlex.quote(conf.kwiver_log_level)}",
            f"{shlex.quote(str(conf.viame_executable))} train",
            "--input-list",
            shlex.quote(str(input_folder_file_list)),
            "--input-truth",
            shlex.quote(str(ground_truth_file_list)),
            "--config",
            shlex.quote(str(config_file)),
            "--no-query",
        ]

        for split in ('validation', 'test'):
            if split_inputs[split]:
                data_list_path, truth_list_path = write_training_lists(
                    input_path, split, split_inputs[split]
                )
                command.append(f"--{split}-list")
                command.append(shlex.quote(str(data_list_path)))
                command.append(f"--{split}-truth")
                command.append(shlex.quote(str(truth_list_path)))

        if annotated_frames_only:
            command.append("--gt-frames-only")

        if label_text:
            labels_path = input_path / "labels.txt"
            with open(labels_path, "w+") as labels_file:
                labels_file.write(label_text)
            command.append("--labels")
            command.append(shlex.quote(str(labels_path)))

        if model:
            model_path = None
            if model.get('folderId', False):
                trained_pipeline_path = utils.make_directory(
                    _working_directory_path / 'trained_pipeline'
                )
                gc.downloadFolderRecursive(model["folderId"], str(trained_pipeline_path))
                model_path = trained_pipeline_path / model["name"]
            elif model.get('path', False):
                model_path = model['path']
            if model_path:
                command.append("--init-weights")
                command.append(shlex.quote(str(model_path)))

        manager.updateStatus(JobStatus.RUNNING)
        popen_kwargs = {
            'args': " ".join(command),
            'shell': True,
            'executable': '/bin/bash',
            'cwd': output_path,
            'env': conf.gpu_process_env,
        }
        utils.stream_subprocess(self, context, manager, popen_kwargs)

        # Check that there are results in the output path
        if len(list(training_results_path.glob("*"))) == 0:
            raise RuntimeError("Training output didn't produce results, discarding...")

        manager.updateStatus(JobStatus.PUSHING_OUTPUT)
        # This is the name of the folder that is uploaded to the
        # "Training Results" girder folder
        girder_output_folder = gc.createFolder(
            results_folder_id,
            pipeline_name,
            metadata={
                constants.TrainedPipelineMarker: True,
                "trained_on": dataset_input_list,
            },
        )
        gc.upload(f"{training_results_path}/*", girder_output_folder["_id"])
