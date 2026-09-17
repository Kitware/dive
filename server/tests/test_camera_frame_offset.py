from unittest.mock import MagicMock, patch

from girder.exceptions import RestException
import pytest

from dive_server import crud_annotation, crud_dataset
from dive_server.crud_annotation import IDENTIFIER
from dive_utils import constants


def _track(track_id, frames):
    return {
        'id': track_id,
        'begin': frames[0],
        'end': frames[-1],
        'confidencePairs': [['fish', 1.0]],
        'attributes': {},
        'features': [{'frame': frame, 'bounds': [0, 0, 1, 1]} for frame in frames],
    }


class TestShiftTrackFrames:
    def test_moves_features_and_bounds(self):
        shifted = crud_annotation.shift_track_frames(_track(1, [3, 4, 5]), 9)
        assert [f['frame'] for f in shifted['features']] == [12, 13, 14]
        assert (shifted['begin'], shifted['end']) == (12, 14)

    def test_drops_features_before_frame_zero(self):
        shifted = crud_annotation.shift_track_frames(_track(1, [3, 4, 5]), -4)
        assert [f['frame'] for f in shifted['features']] == [0, 1]
        assert (shifted['begin'], shifted['end']) == (0, 1)

    def test_rebounds_to_the_first_surviving_feature(self):
        # A gap after the dropped feature: begin follows the data, not a clamp to 0.
        shifted = crud_annotation.shift_track_frames(_track(1, [3, 10]), -5)
        assert [f['frame'] for f in shifted['features']] == [5]
        assert (shifted['begin'], shifted['end']) == (5, 5)

    def test_none_when_nothing_survives(self):
        assert crud_annotation.shift_track_frames(_track(1, [0, 1]), -5) is None

    def test_identity_at_zero(self):
        track = _track(1, [1])
        assert crud_annotation.shift_track_frames(track, 0) is track


class TestShiftGroupFrames:
    def test_moves_and_clips_member_ranges(self):
        group = {
            'id': 1,
            'begin': 2,
            'end': 20,
            'members': {'1': {'ranges': [[2, 6], [10, 20]]}, '2': {'ranges': [[0, 1]]}},
        }
        shifted = crud_annotation.shift_group_frames(group, -4)
        assert shifted['members'] == {'1': {'ranges': [[0, 2], [6, 16]]}}
        assert (shifted['begin'], shifted['end']) == (0, 16)

    def test_none_when_no_member_survives(self):
        group = {'id': 1, 'begin': 0, 'end': 1, 'members': {'1': {'ranges': [[0, 1]]}}}
        assert crud_annotation.shift_group_frames(group, -2) is None


@patch('dive_server.crud_annotation.save_annotations')
@patch('dive_server.crud_annotation.GroupItem')
@patch('dive_server.crud_annotation.TrackItem')
@patch('dive_server.crud_annotation.RevisionLogItem')
def test_shift_annotation_frames_writes_every_set(revision_log, track_item, group_item, save):
    folder = {'_id': 'camera-id'}
    revision_log.return_value.sets.return_value = [None, 'review']
    track_item.return_value.list.side_effect = lambda _f, set=None: [
        _track(1, [3, 4]),
        _track(2, [0]),
    ]
    group_item.return_value.list.return_value = []

    counts = crud_annotation.shift_annotation_frames(folder, {'login': 'u'}, -2)

    assert counts == {'tracks': 2, 'groups': 0, 'dropped': 2}
    assert save.call_count == 2
    assert [call.kwargs['set'] for call in save.call_args_list] == ['', 'review']
    first = save.call_args_list[0].kwargs
    assert [t[IDENTIFIER] for t in first['upsert_tracks']] == [1]
    assert first['upsert_tracks'][0]['begin'] == 1
    assert first['delete_tracks'] == [2]
    assert first['description'] == 'shift frames by -2'


@patch('dive_server.crud_annotation.save_annotations')
@patch('dive_server.crud_annotation.TrackItem')
def test_shift_annotation_frames_is_a_no_op_at_zero(track_item, save):
    counts = crud_annotation.shift_annotation_frames({'_id': 'x'}, {'login': 'u'}, 0)
    assert counts == {'tracks': 0, 'groups': 0, 'dropped': 0}
    track_item.return_value.list.assert_not_called()
    save.assert_not_called()


def _multi_parent(applied=None):
    return {
        '_id': 'parent-id',
        'meta': {
            'annotate': True,
            'type': constants.MultiType,
            'fps': 5,
            'multiCam': {
                'defaultDisplay': 'EO',
                'cameras': {
                    'EO': {'folderId': 'eo-id', 'type': 'video'},
                    'IR': {'folderId': 'ir-id', 'type': 'video'},
                },
            },
            **({'cameraFrameOffsetsApplied': applied} if applied else {}),
        },
    }


@patch('dive_server.crud_dataset.update_metadata')
@patch('dive_server.crud_dataset.crud_annotation.shift_annotation_frames')
@patch('dive_server.crud_dataset.Folder')
def test_apply_camera_frame_offset_shifts_only_the_unapplied_part(folder_cls, shift, update):
    parent = _multi_parent(applied={'IR': 4})
    child = {'_id': 'ir-id'}
    folder_cls.return_value.load.return_value = child
    shift.return_value = {'tracks': 3, 'groups': 0, 'dropped': 1}
    user = {'login': 'u'}

    result = crud_dataset.apply_camera_frame_offset(parent, user, 'IR', 9)

    shift.assert_called_once_with(child, user, 5)
    update.assert_called_once_with(
        parent,
        {'cameraFrameOffsets': {'IR': 9}, 'cameraFrameOffsetsApplied': {'IR': 9}},
        verify=False,
    )
    assert result == {
        'camera': 'IR',
        'offset': 9,
        'delta': 5,
        'tracks': 3,
        'groups': 0,
        'dropped': 1,
    }


@patch('dive_server.crud_dataset.update_metadata')
@patch('dive_server.crud_dataset.crud_annotation.shift_annotation_frames')
@patch('dive_server.crud_dataset.Folder')
def test_apply_camera_frame_offset_rejects_unknown_camera(folder_cls, shift, update):
    with pytest.raises(RestException):
        crud_dataset.apply_camera_frame_offset(_multi_parent(), {'login': 'u'}, 'UV', 1)
    shift.assert_not_called()
    update.assert_not_called()


@patch('dive_server.crud_dataset.update_metadata')
@patch('dive_server.crud_dataset.crud_annotation.shift_annotation_frames')
def test_apply_camera_frame_offset_rejects_single_camera_dataset(shift, update):
    folder = {'_id': 'x', 'meta': {'annotate': True, 'type': constants.VideoType, 'fps': 5}}
    with pytest.raises(RestException):
        crud_dataset.apply_camera_frame_offset(folder, {'login': 'u'}, 'EO', 1)
    shift.assert_not_called()
