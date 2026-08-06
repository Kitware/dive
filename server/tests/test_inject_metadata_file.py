"""Locating the downloaded frame metadata sidecar for an opt-in pipeline.

girder_client.downloadItem writes `dest/<item name>` only when the item holds exactly one file
whose name equals the item name. Otherwise it creates `dest/<item name>/` and writes the files
inside. These tests pin that both shapes bind a real file to the KWIVER setting.
"""

from pathlib import Path

from dive_tasks.tasks import _inject_dataset_metadata_file


class FakeGirderClient:
    """Reproduces downloadItem's nest-or-flatten rule over a fake item."""

    def __init__(self, item_name, file_names):
        self.item_name = item_name
        self.file_names = file_names

    def getItem(self, _item_id):
        return {'name': self.item_name}

    def downloadItem(self, _item_id, dest, name=None):
        dest_path = Path(dest)
        if len(self.file_names) == 1 and self.file_names[0] == self.item_name:
            (dest_path / self.item_name).write_text('frame,lat\n0,-124.6\n')
            return
        nested = dest_path / self.item_name
        nested.mkdir(parents=True, exist_ok=True)
        for file_name in self.file_names:
            (nested / file_name).write_text('frame,lat\n0,-124.6\n')


class RecordingManager:
    def __init__(self):
        self.messages = []

    def write(self, message):
        self.messages.append(message)


def _params():
    return {'metadata_file_item_id': 'item-id', 'metadata_file_key': 'stabilizer:flight_log'}


def _setting_path(command):
    """The path bound by the single `-s key=path` entry the injection appends."""
    assert len(command) == 1
    return Path(command[0].split('=', 1)[1])


def test_binds_the_file_when_girder_client_writes_it_flat(tmp_path):
    gc = FakeGirderClient('frame-metadata.csv', ['frame-metadata.csv'])
    command = []

    _inject_dataset_metadata_file(command, gc, tmp_path, _params(), RecordingManager())

    bound = _setting_path(command)
    assert bound.is_file()
    assert bound.name == 'frame-metadata.csv'


def test_binds_the_file_when_girder_client_nests_it_under_the_item_name(tmp_path):
    # Item renamed after upload: the item is 'flight-log-v2.csv' but its file is still
    # 'frame-metadata.csv', so girder_client creates a directory. Reconstructing
    # md_dir/<item name> would yield that directory, which exists() accepts.
    gc = FakeGirderClient('flight-log-v2.csv', ['frame-metadata.csv'])
    command = []

    _inject_dataset_metadata_file(command, gc, tmp_path, _params(), RecordingManager())

    bound = _setting_path(command)
    assert bound.is_file(), 'must bind the contained file, never the directory'
    assert bound.name == 'frame-metadata.csv'


def test_warns_when_the_item_downloads_nothing(tmp_path):
    gc = FakeGirderClient('nav.csv', [])
    command = []
    manager = RecordingManager()

    _inject_dataset_metadata_file(command, gc, tmp_path, _params(), manager)

    assert command == []
    assert 'no downloadable file' in manager.messages[0]


def test_is_a_no_op_when_the_pipeline_did_not_opt_in(tmp_path):
    gc = FakeGirderClient('nav.csv', ['nav.csv'])
    command = []

    _inject_dataset_metadata_file(command, gc, tmp_path, {}, RecordingManager())

    assert command == []
