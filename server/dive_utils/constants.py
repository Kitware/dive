import re

SETTINGS_CONST_JOBS_CONFIGS = 'jobs_configs'
BRAND_DATA_CONFIG = 'brand_data_config'
INSTALLED_ADDONS_CONFIGS = 'installed_addons'

ImageSequenceType = "image-sequence"
VideoType = "video"
LargeImageType = "large-image"
DefaultVideoFPS = 10
JsonMetaCurrentVersion = 1
SettingsCurrentVersion = 1
AnnotationsCurrentVersion = 2

webValidImageFormats = {"png", "jpg", "jpeg"}
validImageFormats = {*webValidImageFormats, "sgi", "bmp", "pgm"}
validVideoFormats = {
    "mp4",
    "webm",
    "avi",
    "mov",
    "wmv",
    "mpg",
    "mpeg",
    "mp2",
    "ogg",
    "flv",
}
validLargeImageFormats = {
    "nitf",
    "tif",
    "tiff",
    "ntf",
    "vrt",
    "r0",
    "r1",
    "r2",
    "r3",
    "r4",
    "r5",
    "r6",
}
allValidLargeImageFormats = {*validImageFormats, *validLargeImageFormats}


videoRegex = re.compile(r"(\." + r"|\.".join(validVideoFormats) + ')$', re.IGNORECASE)
imageRegex = re.compile(r"(\." + r"|\.".join(validImageFormats) + ')$', re.IGNORECASE)
largeImageRegEx = re.compile(r"(\." + r"|\.".join(validLargeImageFormats) + ')$', re.IGNORECASE)
allLargeImageRegEx = re.compile(
    r"(\." + r"|\.".join(allValidLargeImageFormats) + ')$', re.IGNORECASE
)
safeImageRegex = re.compile(r"(\." + r"|\.".join(webValidImageFormats) + ')$', re.IGNORECASE)
csvRegex = re.compile(r"\.csv$", re.IGNORECASE)
jsonRegex = re.compile(r"\.json$", re.IGNORECASE)
ymlRegex = re.compile(r"\.ya?ml$", re.IGNORECASE)
zipRegex = re.compile(r"\.zip$", re.IGNORECASE)
metaRegex = re.compile(r"^.*\.?(meta|config)\.json$", re.IGNORECASE)

ImageMimeTypes = {
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/bmp",
    "image/x-portable-anymap",
    "image/x-portable-bitmap",
    "image/x-portable-graymap",
    "image/x-rgb",
}

VideoMimeTypes = {
    # web-safe
    "video/webm",
    "video/mp4",
    # avi
    "video/avi",
    "video/msvideo",
    "video/x-msvideo",
    "video/x-ms-wmv",
    # mov
    "video/quicktime",
    # mpeg
    "video/mpeg",
    "video/x-mpeg",
    "video/x-mpeq2a"
    # ogg
    "video/ogg",
    # flv
    "video/x-flv",
}

LargeImageMimeTypes = {
    "image/geotiff",
    "image/tiff",
    "image/x-tiff",
    "image/nitf",
    "image/ntf",
}

# Metadata markers
DatasetMarker = "annotate"
PublishedMarker = "published"
SharedMarker = "shared"
ProcessedMarker = "processed"
ForeignMediaIdMarker = "foreign_media_id"
TrainedPipelineMarker = "trained_pipeline"
TypeMarker = "type"
AssetstoreSourceMarker = "import_source"
AssetstoreSourcePathMarker = "import_path"
FPSMarker = "fps"
OriginalFPSMarker = "originalFps"
OriginalFPSStringMarker = "originalFpsString"
ConfidenceFiltersMarker = "confidenceFilters"

# Other constants
TrainedPipelineCategory = "trained"

# The name of the folder where any user specific data should be stored
# (created as a folder of that user)
ViameDataFolderName = "VIAME"
# The name of the subfolder for training results
TrainingOutputFolderName = "VIAME Training Results"
# The name of the source folder holding zip backups
SourceFolderName = "source"
# The name of the auxiliary folder
AuxiliaryFolderName = "auxiliary"
# the name of the meta file
MetaFileName = "meta.json"

# job constants
JOBCONST_DATASET_ID = 'dataset_id'
JOBCONST_PARAMS = 'params'
JOBCONST_PRIVATE_QUEUE = 'private_queue'
JOBCONST_CREATOR = 'creator'

# User queue constants
UserPrivateQueueEnabledMarker = 'user_private_queue_enabled'


AddonsListURL = 'https://github.com/VIAME/VIAME/raw/main/cmake/download_viame_addons.csv'
