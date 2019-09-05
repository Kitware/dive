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
    print(" ".join(command))
    process = Popen(" ".join(command), stderr=PIPE, stdout=PIPE, shell=True)
    stdout, stderr = process.communicate()
    output = str(stdout) + "\n" + str(stderr)
    self.job_manager.write(output)
    return output_path

