"""
VIAME Segmentation Service for DIVE Web (Girder)

This service provides interactive segmentation using KWIVER algorithms:
- SegmentViaPoints: For point-based segmentation
- PerformTextQuery: For text-based detection/segmentation

Algorithm implementations and model details are determined by the config file
(interactive_segmenter_default.conf) in the VIAME install directory.
"""

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


def find_viame_install() -> Optional[Path]:
    """Find the VIAME installation directory."""
    if 'VIAME_INSTALL' in os.environ:
        path = Path(os.environ['VIAME_INSTALL'])
        if path.exists():
            return path

    this_file = Path(__file__).resolve()
    candidates = [
        this_file.parent.parent.parent.parent.parent.parent / "build" / "install",
        Path("/opt/noaa/viame"),
        Path.home() / "viame",
    ]

    for candidate in candidates:
        if (candidate / "setup_viame.sh").exists():
            return candidate

    return None


def find_segmentation_config() -> Optional[Path]:
    """
    Find the segmentation config file in VIAME install.

    Returns:
        Path to config file if found, None otherwise
    """
    viame_install = find_viame_install()
    if not viame_install:
        return None

    pipelines_dir = viame_install / "configs" / "pipelines"

    config_path = pipelines_dir / "interactive_segmenter_default.conf"
    if config_path.exists():
        return config_path

    return None


def _parse_config_file(config_path: Path) -> Dict[str, str]:
    """Parse a KWIVER .conf file into key-value pairs."""
    config = {}
    with open(config_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, _, value = line.partition('=')
                config[key.strip()] = value.strip()
    return config


class ViameSegmentationService:
    """
    Singleton segmentation service using KWIVER algorithms.

    This service provides:
    - Point-based segmentation via SegmentViaPoints algorithm
    - Text-based detection via PerformTextQuery algorithm (optional)

    Algorithm implementations are determined by the VIAME config file.
    Thread-safe with lazy initialization of algorithms.
    """

    _instance: Optional['ViameSegmentationService'] = None
    _lock = threading.Lock()

    def __new__(cls) -> 'ViameSegmentationService':
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, '_initialized', False):
            return

        self._segment_algo = None
        self._text_query_algo = None
        self._algo_lock = threading.Lock()
        self._current_image_path: Optional[str] = None
        self._current_image_container = None

        self._config_path = None
        self.device = os.environ.get('SEGMENTATION_DEVICE', 'cuda')
        self.hole_policy = "allow"
        self.multipolygon_policy = "allow"
        self.max_polygon_points = 25

        self._initialized = True

    def configure(
        self,
        config_path: Optional[str] = None,
        device: Optional[str] = None,
    ) -> None:
        """
        Configure the service before first use.

        Args:
            config_path: Path to KWIVER config file
            device: Device to use (cuda, cpu)
        """
        if config_path:
            self._config_path = Path(config_path)
        if device:
            self.device = device

    def _ensure_algorithms_loaded(self) -> None:
        """Load the segmentation algorithms if not already loaded."""
        if self._segment_algo is not None:
            return

        with self._algo_lock:
            if self._segment_algo is not None:
                return

            logger.info("Loading segmentation algorithms...")

            try:
                from kwiver.vital.algo import SegmentViaPoints, PerformTextQuery
                from kwiver.vital.config import config as vital_config
                from kwiver.vital.modules import modules as vital_modules

                # Load KWIVER modules
                vital_modules.load_known_modules()

                # Find and parse config file
                if not self._config_path:
                    self._config_path = find_segmentation_config()
                if not self._config_path:
                    raise RuntimeError(
                        "Segmentation config file not found. "
                        "Ensure interactive_segmenter_default.conf is installed."
                    )
                logger.info(f"  Config file: {self._config_path}")

                parsed_config = _parse_config_file(self._config_path)
                algo_type = parsed_config.get("type", "")
                if not algo_type:
                    raise RuntimeError(
                        f"No 'type' specified in config file: {self._config_path}"
                    )
                logger.info(f"  Algorithm type: {algo_type}")

                # Create and configure SegmentViaPoints from config
                self._segment_algo = SegmentViaPoints.create(algo_type)
                seg_cfg = vital_config.empty_config()
                prefix = f"{algo_type}:"
                for key, value in parsed_config.items():
                    if key.startswith(prefix):
                        param = key[len(prefix):]
                        seg_cfg.set_value(param, value)
                seg_cfg.set_value("device", self.device)
                self._segment_algo.set_configuration(seg_cfg)

                # Try to create PerformTextQuery from the same config
                try:
                    text_algo = PerformTextQuery.create(algo_type)
                    text_cfg = vital_config.empty_config()
                    for key, value in parsed_config.items():
                        if key.startswith(prefix):
                            param = key[len(prefix):]
                            text_cfg.set_value(param, value)
                    text_cfg.set_value("device", self.device)
                    text_algo.set_configuration(text_cfg)
                    self._text_query_algo = text_algo
                except Exception as e:
                    logger.info(f"  PerformTextQuery not available for this config: {e}")
                    self._text_query_algo = None

                logger.info("Segmentation algorithms loaded successfully")

            except ImportError as e:
                logger.error(f"KWIVER not available: {e}")
                raise RuntimeError(
                    "KWIVER algorithms not available. "
                    "Ensure kwiver Python bindings are installed."
                ) from e
            except Exception as e:
                logger.error(f"Failed to load segmentation algorithms: {e}")
                raise

    def _load_image(self, image_path: str):
        """Load an image and return a vital ImageContainer."""
        from kwiver.vital.types.types import ImageContainer, Image
        from PIL import Image as PILImage

        img = PILImage.open(image_path).convert("RGB")
        img_array = np.array(img)
        return ImageContainer(Image(img_array))

    def _mask_to_polygon(
        self, mask: np.ndarray
    ) -> Tuple[List[List[float]], List[float]]:
        """Convert binary mask to polygon coordinates."""
        from viame.core.segmentation_utils import mask_to_polygon

        polygon, bounds = mask_to_polygon(
            mask, self.hole_policy, self.multipolygon_policy
        )
        return polygon, bounds

    def _mask_to_polygons(
        self, mask: np.ndarray
    ) -> Tuple[List[dict], List[float]]:
        """Convert binary mask to multiple polygon coordinates with holes."""
        from viame.core.segmentation_utils import mask_to_polygons

        polygons, bounds = mask_to_polygons(
            mask, self.hole_policy, self.multipolygon_policy
        )
        return polygons, bounds

    def _adaptive_simplify_polygon(
        self,
        polygon: List[List[float]],
        max_points: int = 25,
        min_points: int = 4,
    ) -> List[List[float]]:
        """Adaptively simplify a polygon based on its shape complexity."""
        from viame.core.segmentation_utils import adaptive_simplify_polygon

        return adaptive_simplify_polygon(polygon, max_points, min_points)

    def _detections_to_result(self, detected_objects) -> Dict[str, Any]:
        """Convert DetectedObjectSet to result dictionary."""
        if len(detected_objects) == 0:
            return {
                "success": True,
                "polygon": [],
                "bounds": [0, 0, 0, 0],
                "score": 0.0,
            }

        # Get the first (best) detection
        det_obj = next(iter(detected_objects))
        bbox = det_obj.bounding_box()
        bounds = [bbox.min_x(), bbox.min_y(), bbox.max_x(), bbox.max_y()]
        score = det_obj.confidence()

        polygon = []
        polygons_data = None
        if det_obj.mask is not None:
            mask = det_obj.mask.image().asarray()
            if mask is not None and mask.size > 0:
                if mask.ndim == 3:
                    mask = mask[:, :, 0]
                mask = (mask > 0).astype(np.uint8)

                # The mask is cropped to bbox, need to offset coordinates
                poly_local, poly_bounds = self._mask_to_polygon(mask)

                # Get multi-polygon data with holes
                raw_polygons, mp_bounds = self._mask_to_polygons(mask)

                x_offset = bounds[0]
                y_offset = bounds[1]

                # Offset polygon by bbox origin
                if poly_local:
                    polygon = [
                        [p[0] + x_offset, p[1] + y_offset]
                        for p in poly_local
                    ]

                    # Simplify polygon
                    if len(polygon) > 4:
                        polygon = self._adaptive_simplify_polygon(
                            polygon, self.max_polygon_points, min_points=4
                        )

                # Offset and simplify multi-polygon data
                if raw_polygons:
                    for poly_data in raw_polygons:
                        ext = poly_data["exterior"]
                        if len(ext) > 4:
                            poly_data["exterior"] = self._adaptive_simplify_polygon(
                                ext, self.max_polygon_points, min_points=4
                            )
                        poly_data["exterior"] = [
                            [x + x_offset, y + y_offset]
                            for x, y in poly_data["exterior"]
                        ]
                        for i, hole in enumerate(poly_data["holes"]):
                            if len(hole) > 4:
                                poly_data["holes"][i] = self._adaptive_simplify_polygon(
                                    hole, self.max_polygon_points, min_points=4
                                )
                            poly_data["holes"][i] = [
                                [x + x_offset, y + y_offset]
                                for x, y in poly_data["holes"][i]
                            ]
                    polygons_data = raw_polygons

                # Use polygon-derived bounds instead of detection bbox
                if poly_local and poly_bounds and poly_bounds != [0, 0, 0, 0]:
                    bounds = [
                        poly_bounds[0] + x_offset, poly_bounds[1] + y_offset,
                        poly_bounds[2] + x_offset, poly_bounds[3] + y_offset,
                    ]
                elif raw_polygons and mp_bounds and mp_bounds != [0, 0, 0, 0]:
                    bounds = [
                        mp_bounds[0] + x_offset, mp_bounds[1] + y_offset,
                        mp_bounds[2] + x_offset, mp_bounds[3] + y_offset,
                    ]

        result: Dict[str, Any] = {
            "success": True,
            "polygon": polygon,
            "bounds": bounds,
            "score": score,
        }

        if polygons_data is not None:
            result["polygons"] = polygons_data

        return result

    def predict(
        self,
        image_path: str,
        points: List[List[float]],
        point_labels: List[int],
        mask_input: Optional[List[List[float]]] = None,
        multimask_output: bool = False,
    ) -> Dict[str, Any]:
        """
        Run point-based segmentation using SegmentViaPoints algorithm.

        Args:
            image_path: Path to the image file
            points: List of [x, y] point coordinates
            point_labels: List of labels (1=foreground, 0=background)
            mask_input: Optional mask for refinement (not currently used)
            multimask_output: Whether to return multiple masks (not currently used)

        Returns:
            Dict with polygon, bounds, score
        """
        from kwiver.vital.types import Point2d

        self._ensure_algorithms_loaded()

        if not points:
            raise ValueError("At least one point is required")

        if len(points) != len(point_labels):
            raise ValueError("points and point_labels must have same length")

        with self._algo_lock:
            # Load image if different from cached
            if self._current_image_path != image_path:
                logger.debug(f"Loading image: {image_path}")
                self._current_image_container = self._load_image(image_path)
                self._current_image_path = image_path

            # Convert points to vital Point2d objects
            vital_points = [Point2d(float(p[0]), float(p[1])) for p in points]
            vital_labels = [int(label) for label in point_labels]

            # Run segmentation
            detected_objects = self._segment_algo.segment(
                self._current_image_container,
                vital_points,
                vital_labels
            )

        return self._detections_to_result(detected_objects)

    def text_query(
        self,
        image_path: str,
        text: str,
        box_threshold: float = 0.3,
        text_threshold: float = 0.25,
        max_detections: int = 10,
    ) -> Dict[str, Any]:
        """
        Detect objects using text query and segment them.

        Args:
            image_path: Path to the image file
            text: Text describing objects to find
            box_threshold: Detection confidence threshold
            text_threshold: Text matching threshold
            max_detections: Maximum number of detections to return

        Returns:
            Dict with list of detections, each containing polygon, bounds, score, label
        """
        from kwiver.vital.types import Timestamp

        self._ensure_algorithms_loaded()

        if self._text_query_algo is None:
            return {
                "success": False,
                "error": "Text query is not supported by the current segmentation config.",
            }

        with self._algo_lock:
            # Load image
            image_container = self._load_image(image_path)

            # Create timestamp
            timestamp = Timestamp()
            timestamp.set_frame(0)

            # Run text query
            track_sets = self._text_query_algo.perform_query(
                text,
                [image_container],
                [timestamp],
                []
            )

        # Extract detections from track set
        detections = []
        if track_sets and len(track_sets) > 0:
            track_set = track_sets[0]
            for track in track_set.tracks():
                if len(detections) >= max_detections:
                    break

                for state in track:
                    det_obj = state.detection()
                    bbox = det_obj.bounding_box()
                    box = [bbox.min_x(), bbox.min_y(), bbox.max_x(), bbox.max_y()]
                    score = det_obj.confidence()

                    detection = {
                        "box": box,
                        "bounds": box,
                        "score": score,
                        "label": text,
                    }

                    if det_obj.type() is not None:
                        detection["label"] = det_obj.type().get_most_likely_class()

                    # Get polygon from mask if available
                    if det_obj.mask is not None:
                        mask = det_obj.mask.image().asarray()
                        if mask is not None and mask.size > 0:
                            if mask.ndim == 3:
                                mask = mask[:, :, 0]
                            mask = (mask > 0).astype(np.uint8)
                            poly_local, _ = self._mask_to_polygon(mask)

                            if poly_local:
                                x_offset = box[0]
                                y_offset = box[1]
                                polygon = [
                                    [p[0] + x_offset, p[1] + y_offset]
                                    for p in poly_local
                                ]
                                if len(polygon) > 4:
                                    polygon = self._adaptive_simplify_polygon(
                                        polygon, self.max_polygon_points, min_points=4
                                    )
                                detection["polygon"] = polygon

                    detections.append(detection)
                    break  # Only first state per track

        return {
            "success": True,
            "detections": detections,
        }

    def set_image(self, image_path: str) -> None:
        """Pre-load an image for multiple predictions."""
        self._ensure_algorithms_loaded()

        with self._algo_lock:
            logger.debug(f"Pre-loading image: {image_path}")
            self._current_image_container = self._load_image(image_path)
            self._current_image_path = image_path

    def clear_image(self) -> None:
        """Clear the cached image."""
        with self._algo_lock:
            self._current_image_container = None
            self._current_image_path = None

    def is_available(self) -> bool:
        """Check if segmentation is available."""
        try:
            from kwiver.vital.algo import SegmentViaPoints  # noqa: F401
        except ImportError:
            return False

        return find_segmentation_config() is not None

    def is_loaded(self) -> bool:
        """Check if the algorithms are currently loaded."""
        return self._segment_algo is not None

    def is_text_query_available(self) -> bool:
        """Check if text query is available."""
        if self.is_loaded():
            return self._text_query_algo is not None

        if not self.is_available():
            return False

        try:
            from kwiver.vital.algo import PerformTextQuery  # noqa: F401
            return True
        except ImportError:
            return False

    def get_service_info(self) -> Dict[str, Any]:
        """Get information about the current service configuration."""
        return {
            'loaded': self.is_loaded(),
            'text_query_available': self._text_query_algo is not None,
            'config_path': str(self._config_path) if self._config_path else None,
            'device': self.device,
        }


# Singleton accessor
_service_instance: Optional[ViameSegmentationService] = None


def get_viame_segmentation_service() -> ViameSegmentationService:
    """Get the singleton ViameSegmentationService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = ViameSegmentationService()
    return _service_instance
