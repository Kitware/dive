"""Import complete trained model packs into Girder."""

from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import BadZipFile

from girder.exceptions import RestException
from girder.models.folder import Folder
from girder.models.upload import Upload

from dive_utils.constants import TrainedPipelineMarker
from dive_utils.model_pack import extract_model_pack, model_pack_name


def import_model_pack(user, archive, filename):
    """Validate before publishing; remove an incomplete pack on upload failure."""
    from .crud_rpc import training_output_folder

    with TemporaryDirectory(prefix='dive-model-') as temp:
        try:
            extract_model_pack(archive, temp)
        except (ValueError, BadZipFile) as exc:
            raise RestException(str(exc), code=400) from exc
        parent = training_output_folder(user)
        name = model_pack_name(filename)
        base = name
        suffix = 2
        while Folder().findOne({'parentId': parent['_id'], 'name': name}):
            name = f'{base} ({suffix})'
            suffix += 1
        folder = Folder().createFolder(parent, name, creator=user, public=False)
        try:
            folders = {'': folder}
            for path in sorted(Path(temp).rglob('*')):
                relative = path.relative_to(temp)
                parent_folder = folders[str(relative.parent) if str(relative.parent) != '.' else '']
                if path.is_dir():
                    folders[str(relative)] = Folder().createFolder(
                        parent_folder, path.name, creator=user, public=False
                    )
                else:
                    with path.open('rb') as stream:
                        Upload().uploadFromFile(
                            stream,
                            path.stat().st_size,
                            path.name,
                            parentType='folder',
                            parent=parent_folder,
                            user=user,
                        )
            Folder().setMetadata(folder, {TrainedPipelineMarker: True})
        except Exception:
            Folder().remove(folder)
            raise
        return {'folderId': str(folder['_id']), 'name': name}
