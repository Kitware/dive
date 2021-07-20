"""
Cli tools for using parts of the DIVE codebase outside a web server environment
"""
import functools
import json
from typing import Dict, Optional, TextIO

import click
from pip._internal.operations.freeze import FrozenRequirement
from pip._vendor.pkg_resources import get_distribution

from dive_server.serializers import kwcoco, viame
from dive_utils import models, strNumericCompare


@click.group()
@click.version_option()
def cli():
    pass


@cli.command(name='verify-dive-json', help="Verify a DIVE json schema file for correctness")
@click.argument('input', type=click.File('rt'))
def verify_dive_json(input: TextIO):
    trackdicts: Dict[str, dict] = json.load(input)
    for t in trackdicts.values():
        models.Track(**t)


@cli.group(name="convert")
@click.version_option()
def convert():
    pass


@convert.command(name="coco2dive")
@click.argument('input', type=click.File('rt'))
@click.option('--output', type=click.File('wt'), default='result.json')
@click.option('--output-attrs', type=click.File('wt'), default='attributes.json')
def convert_coco(input: TextIO, output: TextIO, output_attrs: TextIO):
    coco_json = json.load(input)
    tracks, attributes = kwcoco.load_coco_as_tracks_and_attributes(coco_json)
    json.dump(tracks, output, indent=4)
    json.dump(attributes, output_attrs, indent=4)
    click.echo(f'wrote output {output.name}')
    click.echo(f'wrote attrib {output_attrs.name}')


@convert.command(name="viame2dive")
@click.argument('input', type=click.File('rt'))
@click.option('--output', type=click.File('wt'), default='result.json')
@click.option('--output-attrs', type=click.File('wt'), default='attributes.json')
def convert_viame_csv(input: TextIO, output: TextIO, output_attrs: TextIO):
    rows = input.readlines()
    tracks, attributes = viame.load_csv_as_tracks_and_attributes(rows)
    json.dump(tracks, output, indent=4)
    json.dump(attributes, output_attrs, indent=4)
    click.echo(f'wrote output {output.name}')
    click.echo(f'wrote attrib {output_attrs.name}')


@convert.command(name="dive2viame")
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
    click.echo(f'wrote output {output.name}')


# Detect if we're installed in editable mode
# https://stackoverflow.com/questions/40530000/check-if-my-application-runs-in-development-editable-mode/66480035#66480035
if FrozenRequirement.from_dist(get_distribution('dive-server')):
    from .debug_cli import make_debug_cli

    make_debug_cli(cli)
