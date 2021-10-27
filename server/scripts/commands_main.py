"""
Cli tools for using parts of the DIVE codebase outside a web server environment
"""
import functools
import json
import os
from typing import BinaryIO, Dict, List, Optional, TextIO

import click

from dive_utils import models, strNumericCompare
from dive_utils.constants import FpsOptions
from dive_utils.serializers import google_vertex_ai, kwcoco, meva, viame
from scripts import cli


@cli.command(name='verify-dive-json', help="Verify a DIVE json schema file for correctness")
@click.argument('input', type=click.File('rt'))
def verify_dive_json(input: TextIO):
    trackdicts: Dict[str, dict] = json.load(input)
    for t in trackdicts.values():
        models.Track(**t)
    click.secho('success', fg='green')


@cli.group(name="convert")
@click.version_option()
def convert():
    pass


@convert.command(name="kpf2dive", help="Kitware Packet Format (KPF) to DIVE json")
@click.argument('inputs', type=click.File('rb'), nargs=-1)
@click.option('--output', type=click.File('wt'), default='result.json')
def convert_kpf(inputs: List[BinaryIO], output: TextIO):
    def read_in_chunks(file_object: BinaryIO, chunk_size=524288):
        """
        Lazy function (generator) to read a file piece by piece.
        """
        while True:
            data = file_object.read(chunk_size)
            if not data:
                break
            yield data

    tracks = meva.load_kpf_as_tracks([read_in_chunks(file) for file in inputs])
    json.dump(tracks, output)
    click.secho(f'wrote output {output.name}', fg='green')


@convert.command(name="coco2dive", help="COCO or KWCOCO json to DIVE json")
@click.argument('input', type=click.File('rt'))
@click.option('--output', type=click.File('wt'), default='result.json')
@click.option('--output-attrs', type=click.File('wt'), default='attributes.json')
def convert_coco(input: TextIO, output: TextIO, output_attrs: TextIO):
    coco_json = json.load(input)
    tracks, attributes = kwcoco.load_coco_as_tracks_and_attributes(coco_json)
    json.dump(tracks, output)
    json.dump(attributes, output_attrs, indent=4)
    click.secho(f'wrote output {output.name}', fg='green')
    click.secho(f'wrote attrib {output_attrs.name}', fg='green')


@convert.command(name="viame2dive", help="VIAME csv to DIVE json")
@click.argument('input', type=click.File('rt'))
@click.option('--output', type=click.File('wt'), default='result.json')
@click.option('--output-attrs', type=click.File('wt'), default='attributes.json')
def convert_viame_csv(input: TextIO, output: TextIO, output_attrs: TextIO):
    rows = input.readlines()
    tracks, attributes = viame.load_csv_as_tracks_and_attributes(rows)
    json.dump(tracks, output)
    json.dump(attributes, output_attrs, indent=4)
    click.secho(f'wrote output {output.name}', fg='green')
    click.secho(f'wrote attrib {output_attrs.name}', fg='green')


@convert.command(name="dive2viame", help="DIVE json to VIAME CSV")
@click.argument('input', type=click.File('rt'))
@click.option(
    '--meta',
    type=click.File('rt'),
    default=None,
    help="Populate image list and fps from meta.json",
)
@click.option('--output', type=click.File('wt'), default='result.csv')
@click.option(
    '--exclude-below',
    type=click.FloatRange(0, 1),
    default=0,
    help="Exclude tracks below confidence value",
)
@click.option('--fps', type=click.FloatRange(0), default=None, help="Annotation FPS")
def convert_dive_json(
    input: TextIO,
    meta: Optional[TextIO],
    output: TextIO,
    exclude_below: float,
    fps: Optional[float],
):
    data = json.load(input)
    imagelist = []
    if meta:
        metadata = json.load(meta)
        imagelist = sorted(
            metadata['originalImageFiles'],
            key=functools.cmp_to_key(strNumericCompare),
        )
        if fps is None:
            fps = metadata['fps']
    output.writelines(
        viame.export_tracks_as_csv(
            data,
            excludeBelowThreshold=True,
            thresholds={'default': exclude_below},
            filenames=imagelist,
            fps=fps,
        )
    )
    click.secho(f'wrote output {output.name}', fg='green')


@convert.command(name="vertex2dive", help="Google Vertex AI Video Object Tracking to DIVE json.")
@click.argument('input', type=click.File('rt'))
@click.option("--width", help="Video width, since input is a ratio", required=True, type=click.INT)
@click.option(
    "--height", help="Video height, since input is a ratio", required=True, type=click.INT
)
@click.option(
    "--fps",
    help="""Choose an annotation FPS. DIVE keeps time in frames rather than in seconds,
    so you need to find a supported framerate such that all timestamps in the input data
    correspond to whole number frames in the output.""",
    required=True,
    type=click.Choice(str(option) for option in FpsOptions),
)
def convert_google_vertex_ai(input: TextIO, width: int, height: int, fps: float):
    rows = input.readlines()
    for row in rows:
        name, tracks, _ = google_vertex_ai.load_video_tracking(row, width, height, int(fps))
        output_file_name = os.path.basename(f'{name}.dive.json')
        with open(output_file_name, 'w') as output:
            json.dump(tracks, output)
            click.secho(
                f'Wrote output {output_file_name}.',
                fg='green',
            )
    click.secho(f'Be sure to choose FPS={fps} if loading this data into DIVE.', fg='yellow')
