"""
Vital Algorithm-based Segmentation Service for DIVE Web (Girder)

This service provides interactive segmentation using KWIVER vital algorithms:
- SegmentViaPoints: For point-based segmentation (SAM2/SAM3)
- PerformTextQuery: For text-based detection/segmentation (SAM3)

The service uses the shared model cache from viame.pytorch.sam3_utilities to avoid
loading duplicate models when both algorithms are configured with the same checkpoint.

This replaces the previous sam2_service.py and sam3_service.py with a unified
implementation based on KWIVER vital algorithms.
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


def find_segmentation_config(model_type: str = "sam3") -> Optional[Path]:
    """
    Find the segmentation config file in VIAME install.

    Args:
        model_type: Type of model ('sam2' or 'sam3')

    Returns:
        Path to config file if found, None otherwise
    """
    viame_install = find_viame_install()
    if not viame_install:
        return None

    pipelines_dir = viame_install / "configs" / "pipelines"

    # Map model type to config file (use the new common_sam*_segmenter.conf files)
    config_files = {
        "sam2": "common_sam2_segmenter.conf",
        "sam3": "common_sam3_segmenter.conf",
    }

    config_name = config_files.get(model_type)
    if config_name:
        config_path = pipelines_dir / config_name
        if config_path.exists():
            return config_path

    # Fallback to any available config
    for name in ["common_sam3_segmenter.conf", "common_sam2_segmenter.conf"]:
        config_path = pipelines_dir / name
        if config_path.exists():
            return config_path

    return None


class VitalSegmentationService:
    """
    Singleton segmentation service using KWIVER vital algorithms.

    This service provides:
    - Point-based segmentation via SegmentViaPoints algorithm
    - Text-based detection via PerformTextQuery algorithm (optional)

    Thread-safe with lazy initialization of algorithms.
    """

    _instance: Optional['VitalSegmentationService'] = None
    _lock = threading.Lock()

    def __new__(cls) -> 'VitalSegmentationService':
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
        self._backend_type: Optional[str] = None

        # Configuration - will be set properly when algorithms are loaded
        self._config_path = None
        self.device = os.environ.get('SEGMENTATION_DEVICE', 'cuda')
        self.checkpoint = os.environ.get('SAM_MODEL_PATH', '')
        self.model_config = os.environ.get('SAM_CONFIG_PATH', '')
        self.hole_policy = "remove"
        self.multipolygon_policy = "largest"
        self.max_polygon_points = 25

        self._initialized = True

    def configure(
        self,
        config_path: Optional[str] = None,
        device: Optional[str] = None,
        checkpoint: Optional[str] = None,
        model_config: Optional[str] = None,
        backend_type: Optional[str] = None,
    ) -> None:
        """
        Configure the service before first use.

        Args:
            config_path: Path to KWIVER config file
            device: Device to use (cuda, cpu)
            checkpoint: Path to model checkpoint
            model_config: Path to model config JSON
            backend_type: Backend type ('sam2' or 'sam3')
        """
        if config_path:
            self._config_path = Path(config_path)
        if device:
            self.device = device
        if checkpoint:
            self.checkpoint = checkpoint
        if model_config:
            self.model_config = model_config
        if backend_type:
            self._backend_type = backend_type

    def _ensure_algorithms_loaded(self) -> None:
        """Load the vital algorithms if not already loaded."""
        if self._segment_algo is not None:
            return

        with self._algo_lock:
            if self._segment_algo is not None:
                return

            logger.info("Loading vital segmentation algorithms...")

            try:
                from kwiver.vital.algo import SegmentViaPoints, PerformTextQuery
                from kwiver.vital.config import config as vital_config
                from kwiver.vital.modules import modules as vital_modules

                # Load KWIVER modules
                vital_modules.load_known_modules()

                # Determine backend type
                backend = self._backend_type or self._detect_backend_type()
                self._backend_type = backend
                logger.info(f"  Using backend: {backend}")

                # Find config file for this backend
                self._config_path = find_segmentation_config(backend)
                if self._config_path:
                    logger.info(f"  Config file: {self._config_path}")

                # Create algorithms directly without config file
                self._segment_algo = self._create_segment_algorithm(backend)
                self._text_query_algo = self._create_text_query_algorithm(backend)

                logger.info("Vital segmentation algorithms loaded successfully")

            except ImportError as e:
                logger.error(f"KWIVER vital not available: {e}")
                raise RuntimeError(
                    "KWIVER vital algorithms not available. "
                    "Ensure kwiver Python bindings are installed."
                ) from e
            except Exception as e:
                logger.error(f"Failed to load vital algorithms: {e}")
                raise

    def _detect_backend_type(self) -> str:
        """Detect which backend to use based on available modules."""
        # Check for sam3 module first (preferred)
        try:
            from sam3.model_builder import build_sam3_image_model  # noqa: F401
            return "sam3"
        except ImportError:
            pass

        # Check for sam2 module
        try:
            from sam2.build_sam import build_sam2  # noqa: F401
            return "sam2"
        except ImportError:
            pass

        # Check for transformers (fallback for sam3)
        try:
            from transformers import Sam2Model  # noqa: F401
            return "sam3"
        except ImportError:
            pass

        # Default to sam2
        return "sam2"

    def _create_segment_algorithm(self, backend: str):
        """Create and configure the SegmentViaPoints algorithm."""
        from kwiver.vital.algo import SegmentViaPoints
        from kwiver.vital.config import config as vital_config

        # Create algorithm instance
        algo = SegmentViaPoints.create(backend)

        # Create config
        cfg = vital_config.empty_config()
        cfg.set_value("checkpoint", self.checkpoint or "")
        cfg.set_value("device", self.device)

        if backend == "sam2":
            cfg.set_value("cfg", "configs/sam2.1/sam2.1_hiera_b+.yaml")
        elif backend == "sam3":
            cfg.set_value("model_config", self.model_config or "")

        algo.set_configuration(cfg)
        return algo

    def _create_text_query_algorithm(self, backend: str):
        """Create and configure the PerformTextQuery algorithm (SAM3 only)."""
        if backend != "sam3":
            return None

        try:
            from kwiver.vital.algo import PerformTextQuery
            from kwiver.vital.config import config as vital_config

            algo = PerformTextQuery.create("sam3")

            cfg = vital_config.empty_config()
            cfg.set_value("checkpoint", self.checkpoint or "")
            cfg.set_value("model_config", self.model_config or "")
            cfg.set_value("device", self.device)
            cfg.set_value("detection_threshold", "0.3")
            cfg.set_value("max_detections", "10")
            cfg.set_value("iou_threshold", "0.3")

            algo.set_configuration(cfg)
            return algo

        except Exception as e:
            logger.warning(f"Could not create PerformTextQuery algorithm: {e}")
            return None

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
        if det_obj.mask is not None:
            mask = det_obj.mask.image().asarray()
            if mask is not None and mask.size > 0:
                if mask.ndim == 3:
                    mask = mask[:, :, 0]
                mask = (mask > 0).astype(np.uint8)

                # The mask is cropped to bbox, need to offset coordinates
                poly_local, _ = self._mask_to_polygon(mask)

                # Offset polygon by bbox origin
                if poly_local:
                    x_offset = bounds[0]
                    y_offset = bounds[1]
                    polygon = [
                        [p[0] + x_offset, p[1] + y_offset]
                        for p in poly_local
                    ]

                    # Simplify polygon
                    if len(polygon) > 4:
                        polygon = self._adaptive_simplify_polygon(
                            polygon, self.max_polygon_points, min_points=4
                        )

        return {
            "success": True,
            "polygon": polygon,
            "bounds": bounds,
            "score": score,
        }

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
                "error": "Text query not available (requires SAM3 backend)",
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
        # Check for vital algorithms
        try:
            from kwiver.vital.algo import SegmentViaPoints  # noqa: F401
        except ImportError:
            return False

        # Check for at least one backend
        try:
            from sam2.build_sam import build_sam2  # noqa: F401
            return True
        except ImportError:
            pass

        try:
            from sam3.model_builder import build_sam3_image_model  # noqa: F401
            return True
        except ImportError:
            pass

        try:
            from transformers import Sam2Model  # noqa: F401
            return True
        except ImportError:
            pass

        return False

    def is_loaded(self) -> bool:
        """Check if the algorithms are currently loaded."""
        return self._segment_algo is not None

    def is_text_query_available(self) -> bool:
        """Check if text query is available."""
        if not self.is_available():
            return False

        # Text query requires SAM3 backend
        try:
            from kwiver.vital.algo import PerformTextQuery  # noqa: F401
        except ImportError:
            return False

        # Check for sam3 or transformers
        try:
            from sam3.model_builder import build_sam3_image_model  # noqa: F401
            return True
        except ImportError:
            pass

        try:
            from transformers import Sam2Model  # noqa: F401
            return True
        except ImportError:
            pass

        return False

    def get_backend_info(self) -> Dict[str, Any]:
        """Get information about the current backend configuration."""
        return {
            'backend': self._backend_type,
            'loaded': self.is_loaded(),
            'text_query_available': self._text_query_algo is not None,
            'config_path': str(self._config_path) if self._config_path else None,
            'checkpoint': self.checkpoint or None,
            'device': self.device,
        }


# Singleton accessor
_service_instance: Optional[VitalSegmentationService] = None


def get_vital_segmentation_service() -> VitalSegmentationService:
    """Get the singleton VitalSegmentationService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = VitalSegmentationService()
    return _service_instance


# Aliases for backward compatibility with existing code
def get_sam2_service() -> VitalSegmentationService:
    """Backward compatible alias for get_vital_segmentation_service."""
    return get_vital_segmentation_service()


def get_sam3_service() -> VitalSegmentationService:
    """Backward compatible alias for get_vital_segmentation_service."""
    return get_vital_segmentation_service()
