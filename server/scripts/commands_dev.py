"""
Dev cli includes extra tools that may involve heavy requirements
that should not be shipped with the regular installation or installed in CI

Debug cli needs [dev] extra_require from setuptools.
"""
import os

import click
from girder_client import GirderClient

from scripts import cli, generateLargeDataset


def get_girder_client() -> GirderClient:
    client = GirderClient(apiUrl="https://viame.kitware.com/api/v1")
    apikey = os.environ.get('GIRDER_API_KEY', None)
    if apikey:
        client.authenticate(apiKey=apikey)
    else:
        client.authenticate(interactive=True)
    return client


@cli.command(name='get-image-list')
@click.argument('id', type=click.STRING)
def get_image_list(id):
    """Extract image names from media json file"""
    data = get_girder_client().get(f'dive_dataset/{id}/media')
    for d in data['imageData']:
        click.echo(d['filename'])


@cli.command(name="generate-data", help="Generate fake datasets for testing")
@click.option('--images', default=100, help='Number of Images')
@click.option('--video/--no-video', default=False, help="Video type dataset")
@click.option('--frames', default=100, help='Video Frames')
@click.option("--width", default=10, help="Video Frames")
@click.option("--height", default=10, help="Video Frames")
@click.option("--fps", default=1.0, help="Video Frames")
@click.option('--tracks', default=100, help='Number of Tracks')
@click.option('--types', default=10, help='Number of Types')
@click.option('--track_length', default=1, help='Max Track Length')
@click.option('--directory', default="./dataset", help='outputDirectory')
def generate_dataset(
    images, video, frames, width, height, fps, tracks, types, track_length, directory
):
    if video is False:
        generateLargeDataset.create_images(directory, images, width, height)
    else:
        generateLargeDataset.create_video(directory, width, height, fps, frames)
    generateLargeDataset.create_track_json(
        directory,
        images,
        tracks,
        types,
        track_length,
        width,
        height,
    )
