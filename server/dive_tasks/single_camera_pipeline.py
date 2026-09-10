"""Postprocess single-camera results before publishing annotations."""

import csv
from pathlib import Path
import re
import shlex
import shutil


def csv_rows(text):
    return [row for row in csv.reader(text.splitlines()) if row and row[0].strip().isdigit()]


def remap_csv_ids(text, maximum_other_id):
    ids = {}

    def replace(match):
        key = int(match.group())
        if key not in ids:
            new_id = maximum_other_id + len(ids) + 1
            if new_id > 2**53 - 1:
                raise ValueError('Track ID exceeds the supported integer range.')
            ids[key] = new_id
        return str(ids[key])

    return re.sub(r'^(\s*\d+)(?=,)', replace, text, flags=re.MULTILINE)


def association_pipeline():
    pipeline = '''config _scheduler
  :type thread_per_process

process clock
  :: frame_list_input
  :image_list_file frames.txt
  :image_reader:type ocv

process timestamps
  :: downsample
  :renumber_frames true

connect from clock.timestamp
        to timestamps.timestamp

process pairing
  :: compute_measurements
  :matching_methods input_pairs_only
  :detection_pairing_method calibration
  :detection_pairing_threshold 10
  :calibration_file calibration.json
  :accumulate_track_pairings true
  :pairing_resolution_method most_likely
  :detection_split_threshold 1
  :output_unmatched true
  :average_stereo_classes false

connect from timestamps.timestamp
        to pairing.timestamp
'''
    for side in (1, 2):
        pipeline += f'''
process reader{side}
  :: read_object_track
  :file_name input{side}.csv
  :reader:type viame_csv

connect from clock.image_file_name
        to reader{side}.image_file_name
connect from reader{side}.object_track_set
        to pairing.object_track_set{side}

process writer{side}
  :: write_object_track
  :file_name associated{side}.csv
  :writer:type viame_csv

connect from pairing.object_track_set{side}
        to writer{side}.object_track_set
'''
    return pipeline


def prepare_association(directory, calibration):
    directory = Path(directory)
    rows = [row for side in (1, 2) for row in csv_rows((directory / f'input{side}.csv').read_text())]
    last_frame = max(int(row[2]) for row in rows)
    calibration_name = f'calibration{Path(calibration).suffix}'
    shutil.copyfile(calibration, directory / calibration_name)
    (directory / 'clock.ppm').write_text('P3\n1 1\n255\n0 0 0\n')
    (directory / 'frames.txt').write_text(f'{directory / "clock.ppm"}\n' * (last_frame + 1))
    (directory / 'associate.pipe').write_text(association_pipeline().replace('calibration.json', calibration_name))


def finish_single_camera_run(task, context, manager, conf, gc, params, output_file, working_dir):
    from dive_tasks import utils
    from dive_tasks.multicam_pipeline import find_downloaded_calibration_file

    single = params['single_camera']
    cameras = single['cameras']
    directory = utils.make_directory(Path(working_dir) / 'association')
    maximum_id = -1
    for side, camera in enumerate(cameras, 1):
        target = directory / f'input{side}.csv'
        if camera['name'] == single['camera']:
            shutil.copyfile(output_file, target)
        else:
            # Fetch all current annotations, including those below confidence filters.
            utils.download_annotation_csv(gc, camera['folder_id'], target)
            maximum_id = max([maximum_id] + [int(row[0]) for row in csv_rows(target.read_text())])
    if maximum_id < 0 or not csv_rows(Path(output_file).read_text()):
        return [(params['output_folder'], Path(output_file))]
    if single['mode'] == 'separate':
        target = directory / 'separate-camera.csv'
        target.write_text(remap_csv_ids(Path(output_file).read_text(), maximum_id))
        return [(params['output_folder'], target)]

    cal_dir = utils.make_directory(directory / 'calibration')
    gc.downloadItem(single['calibration_item_id'], str(cal_dir))
    calibration = find_downloaded_calibration_file(cal_dir)
    if calibration is None:
        raise ValueError('Stereo association requires a loaded calibration file.')
    prepare_association(directory, calibration)
    manager.write('Associating stereo detections...\n')
    utils.stream_subprocess(task, context, manager, {
        'args': f'. {shlex.quote(str(conf.viame_setup_script))} && viame run associate.pipe',
        'shell': True, 'executable': '/bin/bash', 'cwd': directory,
        'env': conf.gpu_process_env,
    })
    outputs = [(camera['folder_id'], directory / f'associated{side}.csv')
               for side, camera in enumerate(cameras, 1)]
    for _, output in outputs:
        if not output.exists() or not csv_rows(output.read_text()):
            raise ValueError('Stereo association did not produce annotations for both cameras.')
    return outputs
