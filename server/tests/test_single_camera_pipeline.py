import json
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

# Keep the geometry/CSV checks runnable without the Girder worker environment.
spec = importlib.util.spec_from_file_location(
    'single_camera_pipeline', Path(__file__).parents[1] / 'dive_tasks/single_camera_pipeline.py'
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
csv_rows = module.csv_rows
prepare_association = module.prepare_association
remap_csv_ids = module.remap_csv_ids


def test_remap_all_ids_preserves_tracks_and_fields():
    text = '# header\n2,left,0,10,20,30,40,.8,-1,fish,.8\n2,left,2,11,20,30,40,.9,-1\n0,left,2,3,4,5,6,.7,-1\n'
    result = remap_csv_ids(text, 999)
    assert [row[0] for row in csv_rows(result)] == ['1000', '1000', '1001']
    assert [row[1:] for row in csv_rows(result)] == [row[1:] for row in csv_rows(text)]
    assert result.startswith('# header\n')


def test_remap_rejects_id_overflow():
    with pytest.raises(ValueError, match='integer range'):
        remap_csv_ids('1,left,0,1,2,3,4,1,-1\n', 2**53 - 1)


def test_worker_allocates_above_every_other_camera(tmp_path, monkeypatch):
    def download(_gc, folder, target):
        target.write_text(f'{800 if folder == "left" else 9000},image,0,1,2,3,4,1,-1\n')

    def directory(target):
        target.mkdir()
        return target

    run = Mock()
    monkeypatch.setitem(sys.modules, 'dive_tasks', SimpleNamespace(utils=SimpleNamespace(
        make_directory=directory, download_annotation_csv=download, stream_subprocess=run,
    )))
    monkeypatch.setitem(sys.modules, 'dive_tasks.multicam_pipeline', SimpleNamespace(
        find_downloaded_calibration_file=Mock(),
    ))
    source = tmp_path / 'detections.csv'
    source.write_text('1,image,0,1,2,3,4,1,-1\n1,image,2,1,2,3,4,1,-1\n')
    params = {'output_folder': 'right', 'single_camera': {
        'mode': 'separate', 'camera': 'right',
        'cameras': [{'name': name, 'folder_id': name} for name in ('left', 'right', 'third')],
    }}
    outputs = module.finish_single_camera_run(None, {}, None, None, None, params, source, tmp_path)
    assert len(outputs) == 1
    assert outputs[0][0] == 'right'
    assert [row[0] for row in csv_rows(outputs[0][1].read_text())] == ['9001', '9001']
    run.assert_not_called()


@pytest.mark.skipif(not os.environ.get('DIVE_TEST_VIAME'), reason='Set DIVE_TEST_VIAME to the VIAME executable')
def test_real_stereo_association(tmp_path):
    calibration = {}
    for side in ('left', 'right'):
        calibration.update({f'{key}_{side}': value for key, value in {
            'fx': 1000, 'fy': 1000, 'cx': 500, 'cy': 500,
            'k1': 0, 'k2': 0, 'k3': 0, 'p1': 0, 'p2': 0,
        }.items()})
    calibration.update({'R': [1, 0, 0, 0, 1, 0, 0, 0, 1], 'T': [-100, 0, 0]})
    source = tmp_path / 'source.json'
    source.write_text(json.dumps(calibration))
    # Track 7 spans two frames; same ID on the other camera is deliberately unrelated.
    (tmp_path / 'input1.csv').write_text(
        '7,left,0,480,480,520,520,1,-1,fish,1\n'
        '7,left,2,480,480,520,520,1,-1,fish,1\n'
        '9,left,2,200,100,220,120,1,-1,crab,1\n'
        '11,left,0,480,680,520,720,1,-1,ray,1\n'
        '11,left,1,480,680,520,720,1,-1,ray,1\n'
    )
    (tmp_path / 'input2.csv').write_text(
        '42,right,0,380,480,420,520,1,-1,fish,1\n'
        '42,right,2,380,480,420,520,1,-1,fish,1\n'
        '7,right,3,20,800,40,820,1,-1,shark,1\n'
        '52,right,1,380,680,420,720,1,-1,ray,1\n'
    )
    prepare_association(tmp_path, source)
    result = subprocess.run([os.environ['DIVE_TEST_VIAME'], 'run', 'associate.pipe'],
                            cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    left = csv_rows((tmp_path / 'associated1.csv').read_text())
    right = csv_rows((tmp_path / 'associated2.csv').read_text())
    assert len(left) == 5
    assert len(right) == 4
    left_fish = [row for row in left if 'fish' in row]
    right_fish = [row for row in right if 'fish' in row]
    assert {row[0] for row in left_fish} == {row[0] for row in right_fish}
    assert len({row[0] for row in left_fish}) == 1
    assert {int(row[2]) for row in left_fish} == {0, 2}
    # A match first appearing on the second frame must also remap the earlier state.
    assert len({row[0] for row in left + right if 'ray' in row}) == 1
    unmatched = [row[0] for row in left + right if 'crab' in row or 'shark' in row]
    assert len(set(unmatched)) == 2
    assert set(unmatched).isdisjoint({row[0] for row in left_fish})
