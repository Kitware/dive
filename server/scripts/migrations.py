import json
import re

import click
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.user import User

from dive_server import crud, crud_annotation


@click.command(name="migrate")
@click.option('--dry-run', is_flag=True, default=False)
def migrate_server(dry_run):
    admin_user = User().findOne({'admin': True})
    click.echo(f'Running as user {admin_user["login"]}')
    total_tracks_ingested = 0
    annotation_files = Item().find(
        {'meta.detection': {'$exists': True}, 'meta.migrated': {'$exists': False}},
        sort=[['created', 1]],
    )
    for annotation in annotation_files:
        if annotation['name'].endswith('.json'):
            dataset_id = annotation["meta"]["detection"]
            dataset = Folder().load(dataset_id, user=admin_user)
            crud.verify_dataset(dataset)
            click.echo(f'Migrating annotation file {annotation["name"]} @ {dataset_id}')
            for file in Item().childFiles(annotation):
                if file['name'].endswith('.json'):
                    file_string = b"".join(list(File().download(file, headers=False)())).decode()
                    data_dict = json.loads(file_string)
                    tracks = list(data_dict.values())
                    click.echo(f'  Loading {len(tracks)} tracks into {dataset_id}')
                    total_tracks_ingested += len(tracks)
                    crud_annotation.save_annotations(
                        dataset, tracks, [], admin_user, overwrite=True
                    )
                    annotation['meta']['migrated'] = True
                    Item().updateItem(annotation)
                    break
                else:
                    click.echo(f'  Skipping {annotation["name"]}')
        else:
            click.echo(f'Skipping {annotation["name"]}')
    click.echo(f'Ingested {total_tracks_ingested} tracks')


if __name__ == "__main__":
    migrate_server()
