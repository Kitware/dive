import os
import tempfile
from subprocess import Popen, PIPE

from girder_worker.app import app
from girder_worker.utils import JobStatus


@app.task(bind=True)
def run_pipeline(self, path, pipeline):
    with tempfile.NamedTemporaryFile(suffix='.csv', delete=True) as temp:
        output_path = temp.name

    file_name = os.listdir(path)[0]

    command = [
        'cd /home/VIAME/build/install/ &&',
        '. ./setup_viame.sh &&',
        'pipeline_runner',
        '-s input:video_reader:type=vidl_ffmpeg',
        '-p /home/VIAME/configs/pipelines/{}'.format(pipeline),
        '-s input:video_filename={}'.format(os.path.join(path, file_name)),
        '-s detector_writer:file_name={}'.format(output_path)
    ]
    process = Popen(" ".join(command), stderr=PIPE, stdout=PIPE, shell=True)
    stdout, stderr = process.communicate()
    output = str(stdout) + "\n" + str(stderr)
    self.job_manager.write(output)
    return output_path


@app.task(bind=True)
def convert_video(self, path, itemId, token, videosId):
    self.girder_client.token = token
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=True) as temp:
        output_path = temp.name

    file_name = os.path.join(path, os.listdir(path)[0])
    process = Popen(
        [
            'ffmpeg',
            '-i',
            file_name
        ],
        stderr=PIPE,
        stdout=PIPE
    )
    stdout, stderr = process.communicate()
    output = str(stdout) + "\n" + str(stderr)
    fps_string = [i for i in output.split(',') if 'fps' in i][0]
    fps_value = [int(s) for s in fps_string.split() if s.isdigit()][0]
    self.girder_client.addMetadataToItem(itemId, {'viame': {'fps': fps_value}})

    process = Popen(
        [
            'ffmpeg',
            '-i',
            file_name,
            '-c:v',
            'libx264',
            '-preset',
            'slow',
            '-crf',
            '26',
            '-c:a',
            'copy',
            output_path
        ],
        stderr=PIPE,
        stdout=PIPE
    )
    stdout, stderr = process.communicate()
    output = str(stdout) + "\n" + str(stderr)
    self.job_manager.write(output)
    _file = self.girder_client.uploadFileToFolder(videosId, output_path)
    self.girder_client.addMetadataToItem(_file['itemId'], {'itemId': itemId})
    os.remove(output_path)

