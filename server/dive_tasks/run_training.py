from contextlib import suppress
from pathlib import Path
import shlex
import tempfile
from typing import List, Tuple

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
            "viame runner",
            f"-p {shlex.quote(str(convert_to_onnx_pipeline_path))}",
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
    # List of (input folder, ground truth file) pairs for creating input lists
    input_groundtruth_list: List[Tuple[Path, Path]] = []
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
            input_groundtruth_list.append((download_path, groundtruth_path))

        input_folder_file_list = input_path / "input_folder_list.txt"
        ground_truth_file_list = input_path / "input_truth_list.txt"
        with open(input_folder_file_list, "w+") as data_list:
            with open(ground_truth_file_list, "w+") as truth_list:
                for folder_path, groundtruth_path in input_groundtruth_list:
                    data_list.write(f"{folder_path}\n")
                    truth_list.write(f"{groundtruth_path}\n")

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
