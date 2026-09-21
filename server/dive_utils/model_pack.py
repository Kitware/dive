"""Portable model-pack layout and safe, streaming ZIP extraction."""

from pathlib import Path, PurePosixPath
import re
import shutil
import stat
from zipfile import ZipFile

MAX_FILES = 100000
MAX_BYTES = 100 * 1024**3


def model_pack_paths(names):
    """Map ZIP members to paths relative to the pipeline directory."""
    clean = []
    for name in names:
        path = name.replace('\\', '/')
        parts = path.rstrip('/').split('/')
        if (
            path.startswith('/')
            or any(p in ('..', '') or ':' in p for p in parts)
            or '\x00' in path
        ):
            raise ValueError(f'Unsafe model archive path: {name}')
        if '__MACOSX' in parts or parts[-1] == '.DS_Store':
            continue
        clean.append((name, str(PurePosixPath(path))))

    # Standard VIAME layouts, flat packs, and any of these inside one wrapper.
    candidates = ['configs/pipelines/', 'pipelines/', '']
    wrappers = sorted({p.split('/')[0] for _, p in clean if '/' in p})
    for wrapper in wrappers:
        candidates.extend([f'{wrapper}/configs/pipelines/', f'{wrapper}/pipelines/', f'{wrapper}/'])
    root = next(
        (
            prefix
            for prefix in candidates
            if any(
                p.startswith(prefix) and '/' not in p[len(prefix) :] and p.endswith('.pipe')
                for _, p in clean
            )
        ),
        None,
    )
    if root is None:
        raise ValueError(
            'The ZIP must contain at least one .pipe file in a supported model layout.'
        )
    result = {}
    seen = set()
    for original, path in clean:
        if not path.startswith(root):
            continue
        relative = path[len(root) :]
        if not relative:
            continue
        key = relative.casefold()
        if key in seen:
            raise ValueError(f'Duplicate model archive path: {relative}')
        seen.add(key)
        result[original] = relative
    # A file must not also be a parent directory of another file.
    for relative in result.values():
        if any(str(p).casefold() in seen for p in PurePosixPath(relative).parents if str(p) != '.'):
            raise ValueError(f'Conflicting model archive path: {relative}')
    return result


def model_pack_name(filename):
    """Derive a portable directory name from an uploaded archive name."""
    name = re.sub(r'[^\w .-]', '_', Path(filename.replace('\\', '/')).stem).strip(' .')
    return name or 'Imported model'


def extract_model_pack(archive, destination):
    """Extract into a new staging directory, preserving model-relative paths."""
    with ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries) > MAX_FILES or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError('Model archive exceeds the file count or uncompressed size limit.')
        for entry in entries:
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError('Model archives cannot contain symbolic links or special files.')
        files = [entry for entry in entries if not entry.is_dir()]
        mapping = model_pack_paths([entry.filename for entry in files])
        for entry in files:
            if entry.filename not in mapping:
                continue
            target = Path(destination) / mapping[entry.filename]
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as src, target.open('xb') as dst:
                shutil.copyfileobj(src, dst)
        return mapping
