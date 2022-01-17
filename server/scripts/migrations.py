import json
import logging

import click
from girder import auditLogger
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.user import User

from dive_server import crud, crud_annotation
from dive_utils import TRUTHY_META_VALUES, constants
from scripts import cli


@cli.command(name="migrate")
@click.option('--dry-run', is_flag=True)
@click.option('--limit', type=click.INT, default=0)
def migrate_server(dry_run, limit):
    """
    Migration script is idempotent.
    """
    auditLogger.setLevel(logging.WARN)
    admin_user = User().findOne({'admin': True})
    click.echo(f'Running as user {admin_user["login"]}')
    total_tracks_ingested = 0
    total_datasets_ingested = 0
    datasets = Folder().find(
        {f'meta.{constants.DatasetMarker}': {'$in': TRUTHY_META_VALUES}}, limit=limit
    )
    failures = []
    for dataset in datasets:
        dataset_id = dataset['_id']
        logger_context = f'dataset_id="{str(dataset_id)}" name="{dataset["name"]}'
        logger_context = {
            'dataset_id': str(dataset_id),
            'name': dataset["name"],
        }
        total_datasets_ingested += 1
        annotation_files = Item().find(
            {
                'meta.detection': {'$in': [str(dataset_id), dataset_id]},
                'meta.migrated': {'$exists': False},
            },
            sort=[['created', -1]],
        )

        for index, annotation in enumerate(annotation_files):
            logger_context['item_name'] = annotation['name']
            logger_context['item_id'] = str(annotation['_id'])
            if index == 0:  # Migrate only the first (newest) annotation
                if not annotation['name'].endswith('.json'):
                    failures.append(logger_context)
                    click.echo(f"FAILED: {logger_context}")
                    break
                for file in Item().childFiles(annotation, sort=[['created', -1]]):
                    logger_context['file_name'] = file['name']
                    if not file['name'].endswith('.json'):
                        click.echo(f'WARNING: Skipping {logger_context}')
                        continue
                    assert not annotation['meta'].get(
                        'migrated', False
                    ), f"cannot migrate an item that already migrated: {logger_context}"
                    file_string = b"".join(list(File().download(file, headers=False)())).decode()
                    data_dict = json.loads(file_string)
                    tracks = list(data_dict.values())
                    logger_context['track_count'] = len(tracks)
                    logger_context['char_len'] = len(file_string)
                    total_tracks_ingested += len(tracks)
                    click.echo(f'  migrating {logger_context}')
                    if not dry_run:
                        crud_annotation.save_annotations(
                            dataset,
                            tracks,
                            [],
                            admin_user,
                            overwrite=True,
                            description=f"Migrate {annotation['name']}",
                        )
                    break
            else:
                click.echo(f"            {logger_context}")
            if not dry_run:
                Item().setMetadata(annotation, {'migrated': True})
                Item().move(annotation, crud.get_or_create_auxiliary_folder(dataset, admin_user))
    for failure in failures:
        click.echo(f"FAILED: {failure}")
    click.echo(f'Ingested {total_tracks_ingested} tracks from {total_datasets_ingested} datasets')


if __name__ == "__main__":
    migrate_server()
