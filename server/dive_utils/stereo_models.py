"""
Serve the Fast-FoundationStereo ONNX export to the web client.

The browser builds are published as bare ``.onnx`` files listed in VIAME's
``cmake/download_viame_onnx.csv`` (name, url, description, md5, input height,
input width), separate from the desktop add-on zip. The list is read at
request time rather than pinned here, so a re-published model is picked up
without a DIVE release, and the export whose input best fits the dataset's
imagery is chosen. Each file is fetched once per md5 into a local cache. A zip
is accepted too (the model and sidecar yaml are extracted); a bare file needs
no sidecar, since onnxruntime-web reads the input size from the graph.
"""

import csv
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Callable, Iterable, List, NamedTuple, Optional
import zipfile

import requests

from dive_utils import constants

STEREO_FOUNDATION_MODEL = 'FAST-FDN-STEREO'


class OnnxSource(NamedTuple):
    name: str
    url: str
    md5: str
    height: Optional[int] = None
    width: Optional[int] = None

    @property
    def cache_name(self) -> str:
        if self.height and self.width:
            return f'{self.name}-{self.height}x{self.width}'
        return self.name

    @property
    def area(self) -> int:
        return (self.height or 0) * (self.width or 0)


# Used when the ONNX list has no row for the model (or cannot be fetched): the
# browser builds published on viame.kitware.com.
GIRDER_ITEM = 'https://viame.kitware.com/api/v1/item/{}/download'
DEFAULT_WEB_MODELS = [
    OnnxSource(
        STEREO_FOUNDATION_MODEL,
        GIRDER_ITEM.format('6aa9e846a723aa14eb79b1d4'),
        '0cfea82cc48435a4955a03223e1bbb02',
        448,
        768,
    ),
    OnnxSource(
        STEREO_FOUNDATION_MODEL,
        GIRDER_ITEM.format('6aa9e850e4e84dbe3cb5b403'),
        'da20c1e1837eb520d89f12bb337e38ad',
        576,
        960,
    ),
]
# Forces one input size (e.g. ``448x768``) regardless of the imagery.
FORCED_WEB_MODEL_ENV = 'DIVE_STEREO_WEB_MODEL'
MODEL_CACHE_DIR_ENV = 'DIVE_MODEL_CACHE_DIR'
DEFAULT_MODEL_CACHE_DIR = '/tmp/dive_models'
DOWNLOAD_CHUNK_BYTES = 1 << 20
DOWNLOAD_TIMEOUT_SECONDS = 60


class FoundationModel(NamedTuple):
    onnx_path: Path
    yaml_path: Optional[Path]
    url: str
    md5: str
    # From the list row or the sidecar yaml; None for a bare .onnx with neither.
    height: Optional[int]
    width: Optional[int]


class ModelUnavailableError(Exception):
    """The model could not be resolved, downloaded or verified."""


def _int_or_none(value: str) -> Optional[int]:
    value = value.strip()
    return int(value) if value.isdigit() else None


def parse_onnx_rows(text: str) -> List[OnnxSource]:
    rows = []
    for item in csv.reader(text.splitlines(), delimiter=','):
        if len(item) < 4 or item[0].strip().startswith('#'):
            continue
        item = item + [''] * (6 - len(item))
        rows.append(
            OnnxSource(
                item[0].strip(),
                item[1].strip(),
                item[3].strip().lower(),
                _int_or_none(item[4]),
                _int_or_none(item[5]),
            )
        )
    return rows


def find_models(rows: Iterable[OnnxSource], name: str) -> List[OnnxSource]:
    return [row for row in rows if row.name == name]


def resolve_models(name: str = STEREO_FOUNDATION_MODEL) -> List[OnnxSource]:
    """Every list row for ``name``, else the built-in defaults for it."""
    fallback = find_models(DEFAULT_WEB_MODELS, name)
    try:
        response = requests.get(constants.OnnxListURL, timeout=DOWNLOAD_TIMEOUT_SECONDS)
        response.raise_for_status()
        models = find_models(parse_onnx_rows(response.content.decode('utf-8')), name)
    except requests.RequestException as exc:
        if not fallback:
            raise ModelUnavailableError(f'Could not read the VIAME ONNX list: {exc}') from exc
        models = []
    if models:
        return models
    if not fallback:
        raise ModelUnavailableError(f'The VIAME ONNX list has no {name} entry')
    return fallback


def select_model(
    models: List[OnnxSource],
    image_height: Optional[int] = None,
    image_width: Optional[int] = None,
) -> OnnxSource:
    """
    The export whose input fits the imagery: the smallest one at least as
    large as the frames, else the largest available (frames are downscaled to
    the input either way, so bigger keeps more detail). Without a frame size,
    the smallest. ``DIVE_STEREO_WEB_MODEL=HxW`` forces a size when listed.
    """
    if not models:
        raise ModelUnavailableError('No stereo model is available')
    forced = os.environ.get(FORCED_WEB_MODEL_ENV, '')
    if forced:
        for model in models:
            if f'{model.height}x{model.width}' == forced:
                return model
    sized = sorted((m for m in models if m.area), key=lambda m: m.area)
    if not sized:
        return models[0]
    if image_height and image_width:
        covering = [m for m in sized if m.height >= image_height and m.width >= image_width]
        return covering[0] if covering else sized[-1]
    return sized[0]


def parse_image_size(yaml_text: str) -> Optional[tuple]:
    """``image_size: [H, W]`` from the export's sidecar, in block or flow form."""
    match = re.search(r'image_size:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', yaml_text) or re.search(
        r'image_size:\s*\n\s*-\s*(\d+)\s*\n\s*-\s*(\d+)', yaml_text
    )
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def model_cache_dir() -> Path:
    return Path(os.environ.get(MODEL_CACHE_DIR_ENV, DEFAULT_MODEL_CACHE_DIR))


def _download(url: str, dest: Path) -> str:
    digest = hashlib.md5()
    with requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        response.raise_for_status()
        with open(dest, 'wb') as out:
            for chunk in response.iter_content(DOWNLOAD_CHUNK_BYTES):
                out.write(chunk)
                digest.update(chunk)
    return digest.hexdigest()


def select_web_onnx(onnx_names: List[str]) -> str:
    """
    The add-on may ship two exports: the browser build (`*_web.onnx`, 3-D
    convs rewritten for onnxruntime-web) next to the one VIAME's own CUDA /
    TensorRT path uses. Prefer the web build; fall back to a single export.
    """
    web = [n for n in onnx_names if os.path.basename(n).lower().endswith('_web.onnx')]
    if len(web) == 1:
        return web[0]
    if len(onnx_names) == 1:
        return onnx_names[0]
    raise ModelUnavailableError(
        f'Expected one *_web.onnx or a single .onnx in the add-on, found {sorted(onnx_names)}'
    )


def is_zip(path: Path) -> bool:
    with open(path, 'rb') as handle:
        return handle.read(4) == b'PK\x03\x04'


def extract_model(zip_path: Path, dest_dir: Path) -> FoundationModel:
    """Pull the single ``.onnx`` and its sidecar ``.yaml`` out of an add-on zip."""
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        onnx_name = select_web_onnx([n for n in names if n.lower().endswith('.onnx')])
        yaml_name = os.path.splitext(onnx_name)[0] + '.yaml'
        dest_dir.mkdir(parents=True, exist_ok=True)
        targets = {}
        for member in (onnx_name, yaml_name):
            if member not in names:
                continue
            target = dest_dir / os.path.basename(member)
            with archive.open(member) as src, open(target, 'wb') as out:
                shutil.copyfileobj(src, out)
            targets[member] = target
    return _describe(targets[onnx_name], targets.get(yaml_name), url='', md5='')


def _describe(
    onnx_path: Path,
    yaml_path: Optional[Path],
    url: str,
    md5: str,
    height: Optional[int] = None,
    width: Optional[int] = None,
) -> FoundationModel:
    size = parse_image_size(yaml_path.read_text()) if yaml_path else None
    if size:
        height, width = size
    return FoundationModel(onnx_path, yaml_path, url, md5, height, width)


def _cached(addon: OnnxSource, cache_dir: Path) -> Optional[FoundationModel]:
    model_dir = cache_dir / addon.cache_name / addon.md5
    if not model_dir.is_dir():
        return None
    onnx_files = list(model_dir.glob('*.onnx'))
    if len(onnx_files) != 1:
        return None
    yaml_path = onnx_files[0].with_suffix('.yaml')
    return _describe(
        onnx_files[0],
        yaml_path if yaml_path.is_file() else None,
        addon.url,
        addon.md5,
        addon.height,
        addon.width,
    )


def ensure_model(
    addon: OnnxSource,
    cache_dir: Optional[Path] = None,
    download: Callable[[str, Path], str] = _download,
) -> FoundationModel:
    """
    The cached model for ``addon``, downloading and verifying it first when the
    cache holds nothing for its md5. Older md5 directories are dropped once a
    newer one is in place. Safe across processes sharing the cache directory.
    """
    cache_dir = cache_dir or model_cache_dir()
    addon_dir = cache_dir / addon.cache_name
    addon_dir.mkdir(parents=True, exist_ok=True)
    with open(addon_dir / '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            cached = _cached(addon, cache_dir)
            if cached is not None:
                return cached
            with tempfile.TemporaryDirectory(dir=addon_dir) as tmp:
                download_path = Path(tmp) / 'download'
                try:
                    actual_md5 = download(addon.url, download_path)
                except requests.RequestException as exc:
                    raise ModelUnavailableError(f'Could not download {addon.url}: {exc}') from exc
                if addon.md5 and actual_md5 != addon.md5:
                    raise ModelUnavailableError(
                        f'{addon.name} download did not match the add-on list md5 '
                        f'({actual_md5} != {addon.md5})'
                    )
                staging = Path(tmp) / 'model'
                if is_zip(download_path):
                    extract_model(download_path, staging)
                else:
                    staging.mkdir()
                    download_path.rename(staging / f'{addon.cache_name.lower()}.onnx')
                final_dir = addon_dir / addon.md5
                if final_dir.exists():
                    shutil.rmtree(final_dir)
                shutil.move(str(staging), str(final_dir))
            for stale in addon_dir.iterdir():
                if stale.is_dir() and stale.name != addon.md5:
                    shutil.rmtree(stale, ignore_errors=True)
            cached = _cached(addon, cache_dir)
            if cached is None:
                raise ModelUnavailableError(
                    f'{addon.name} was downloaded but could not be read back'
                )
            return cached
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def ensure_stereo_foundation_model(
    image_height: Optional[int] = None, image_width: Optional[int] = None
) -> FoundationModel:
    return ensure_model(
        select_model(resolve_models(STEREO_FOUNDATION_MODEL), image_height, image_width)
    )
