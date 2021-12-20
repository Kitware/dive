import re

SETTINGS_CONST_JOBS_CONFIGS = 'jobs_configs'
BRAND_DATA_CONFIG = 'brand_data_config'

ImageSequenceType = "image-sequence"
VideoType = "video"
DefaultVideoFPS = 10

webValidImageFormats = {"png", "jpg", "jpeg"}
validImageFormats = {*webValidImageFormats, "tif", "tiff", "sgi", "bmp", "pgm"}
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

videoRegex = re.compile(r"(\." + r"|\.".join(validVideoFormats) + ')$', re.IGNORECASE)
imageRegex = re.compile(r"(\." + r"|\.".join(validImageFormats) + ')$', re.IGNORECASE)
safeImageRegex = re.compile(r"(\." + r"|\.".join(webValidImageFormats) + ')$', re.IGNORECASE)
csvRegex = re.compile(r"\.csv$", re.IGNORECASE)
jsonRegex = re.compile(r"\.json$", re.IGNORECASE)
ymlRegex = re.compile(r"\.ya?ml$", re.IGNORECASE)
zipRegex = re.compile(r"\.zip$", re.IGNORECASE)

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

# Metadata markers
DatasetMarker = "annotate"
PublishedMarker = "published"
SharedMarker = "shared"
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
JOBCONST_DATASET_ID = 'datset_id'
JOBCONST_TRAINING_INPUT_IDS = 'training_input_ids'
JOBCONST_TRAINING_CONFIG = 'training_config'
JOBCONST_LABEL_TEXT = 'label_text'
JOBCONST_RESULTS_FOLDER_ID = 'results_folder_id'
JOBCONST_PIPELINE_NAME = 'pipeline_name'
JOBCONST_PRIVATE_QUEUE = 'private_queue'

# User queue constants
UserPrivateQueueEnabledMarker = 'user_private_queue_enabled'
