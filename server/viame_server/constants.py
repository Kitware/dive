import re

ImageSequenceType = "image-sequence"
VideoType = "video"

webValidImageFormats = {"png", "jpg", "jpeg"}
validImageFormats = {*webValidImageFormats, "tif", "tiff", "sgi", "bmp", "pgm"}
validVideoFormats = {"mp4", "avi", "mov", "mpg"}

videoRegex = re.compile(r"(\." + r"|\.".join(validVideoFormats) + ')$', re.IGNORECASE)
imageRegex = re.compile(r"(\." + r"|\.".join(validImageFormats) + ')$', re.IGNORECASE)
safeImageRegex = re.compile(
    r"(\." + r"|\.".join(webValidImageFormats) + ')$', re.IGNORECASE
)
csvRegex = re.compile(r"\.csv$", re.IGNORECASE)
ymlRegex = re.compile(r"\.ya?ml$", re.IGNORECASE)

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
    "video/mpeg",
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
}


TrainedPipelineMarker = "trained_pipeline"
TrainedPipelineCategory = "trained"
