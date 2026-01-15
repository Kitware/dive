"""
SAM2 Interactive Segmentation Service for Web (Girder)

Provides a singleton SAM2 predictor for fast interactive segmentation.
The model is loaded once and reused for all requests.
"""

import contextlib
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class SAM2Service:
    """
    Singleton SAM2 service for interactive segmentation.

    Thread-safe with lazy initialization of the model.
    """

    _instance: Optional['SAM2Service'] = None
    _lock = threading.Lock()

    def __new__(cls) -> 'SAM2Service':
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        # Only initialize once
        if getattr(self, '_initialized', False):
            return

        self.predictor = None
        self.model = None
        self._model_lock = threading.Lock()
        self._current_image_path: Optional[str] = None

        # Configuration
        self.cfg = "configs/sam2.1/sam2.1_hiera_b+.yaml"
        self.checkpoint = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt"
        self.device = "cuda"
        self.hole_policy = "remove"
        self.multipolygon_policy = "largest"
        self.max_polygon_points = 25

        self._initialized = True

    def _ensure_model_loaded(self) -> None:
        """Load the SAM2 model if not already loaded."""
        if self.predictor is not None:
            return

        with self._model_lock:
            # Double-check after acquiring lock
            if self.predictor is not None:
                return

            try:
                import torch
                from sam2.build_sam import build_sam2
                from sam2.sam2_image_predictor import SAM2ImagePredictor

                logger.info("Loading SAM2 model...")
                logger.info(f"  Config: {self.cfg}")
                logger.info(f"  Checkpoint: {self.checkpoint}")
                logger.info(f"  Device: {self.device}")

                self.model = build_sam2(
                    config_file=self.cfg,
                    ckpt_path=self.checkpoint,
                    device=self.device,
                    mode='eval',
                    apply_postprocessing=True,
                )
                self.predictor = SAM2ImagePredictor(self.model)
                logger.info("SAM2 model loaded successfully")

            except ImportError as e:
                logger.error(f"SAM2 not available: {e}")
                raise RuntimeError(
                    "SAM2 is not installed. Enable VIAME_ENABLE_PYTORCH-SAM2 in your build."
                ) from e
            except Exception as e:
                logger.error(f"Failed to load SAM2 model: {e}")
                raise

    def _load_image(self, image_path: str) -> np.ndarray:
        """Load image from path and return as numpy array."""
        from PIL import Image

        img = Image.open(image_path).convert("RGB")
        return np.array(img)

    def _mask_to_polygon(
        self, mask: np.ndarray
    ) -> Tuple[List[List[float]], List[float]]:
        """
        Convert binary mask to polygon coordinates.

        Returns:
            polygon: List of [x, y] coordinate pairs
            bounds: [x_min, y_min, x_max, y_max]
        """
        import kwimage
        from shapely.geometry import MultiPolygon, Polygon

        # Convert to kwimage mask and then to polygon
        kw_mask = kwimage.Mask.coerce(mask.astype(np.uint8))

        # Convert mask to multi-polygon
        kw_mpoly = kw_mask.to_multi_polygon(
            pixels_are='points',
            origin_convention='center',
        )

        try:
            shape = kw_mpoly.to_shapely()
        except ValueError:
            # Workaround for issues with not enough coordinates
            new_parts = []
            for kw_poly in kw_mpoly.data:
                try:
                    new_part = kw_poly.to_shapely()
                    new_parts.append(new_part)
                except ValueError:
                    pass
            if not new_parts:
                return [], [0, 0, 0, 0]
            shape = MultiPolygon(new_parts)

        # Apply multipolygon policy
        if shape.type == 'MultiPolygon' and len(shape.geoms) > 1:
            if self.multipolygon_policy == 'convex_hull':
                shape = shape.convex_hull
            elif self.multipolygon_policy == 'largest':
                shape = max(shape.geoms, key=lambda p: p.area)

        if shape.type == 'MultiPolygon':
            if not shape.geoms:
                return [], [0, 0, 0, 0]
            shape = MultiPolygon([shape.geoms[0]])
        elif shape.type == 'Polygon':
            shape = MultiPolygon([shape])

        # Apply hole policy
        if self.hole_policy == 'remove' and shape.type == 'MultiPolygon':
            shape = MultiPolygon([Polygon(p.exterior) for p in shape.geoms])

        # Extract polygon coordinates
        if shape.is_empty or not shape.geoms:
            return [], [0, 0, 0, 0]

        # Get the exterior coordinates of the first polygon
        poly = shape.geoms[0]
        coords = list(poly.exterior.coords)
        polygon = [[float(x), float(y)] for x, y in coords]

        # Calculate bounds
        bounds = list(shape.bounds)  # (minx, miny, maxx, maxy)

        return polygon, bounds

    def _adaptive_simplify_polygon(
        self,
        polygon: List[List[float]],
        max_points: int = 25,
        min_points: int = 4,
    ) -> List[List[float]]:
        """
        Adaptively simplify a polygon based on its shape complexity.

        Simple shapes (like rectangles or circles) will use fewer points,
        while complex shapes will use more points up to the maximum.
        """
        import math
        from shapely.geometry import Polygon as ShapelyPolygon

        if len(polygon) <= min_points:
            return polygon

        try:
            shape = ShapelyPolygon(polygon)
            if not shape.is_valid:
                shape = shape.buffer(0)
            if shape.is_empty:
                return polygon
        except Exception:
            return polygon

        area = shape.area
        perimeter = shape.length

        if perimeter <= 0 or area <= 0:
            return polygon

        # Calculate compactness and convexity to estimate shape complexity
        compactness = (4 * math.pi * area) / (perimeter * perimeter)
        convex_hull = shape.convex_hull
        hull_area = convex_hull.area if convex_hull.area > 0 else area
        convexity = area / hull_area

        # Complexity score from 0 (simple) to 1 (complex)
        complexity = 1.0 - (compactness * convexity)

        # Map complexity to target points
        target_points = int(min_points + complexity * (max_points - min_points))
        target_points = max(min_points, min(max_points, target_points))

        if len(polygon) <= target_points:
            return polygon

        # Binary search for optimal simplification tolerance
        low, high = 0.1, 100.0
        best_result = polygon

        for _ in range(20):
            mid = (low + high) / 2
            simplified = shape.simplify(mid, preserve_topology=True)

            if simplified.is_empty:
                high = mid
                continue

            coords = list(simplified.exterior.coords)
            num_points = len(coords)

            if num_points <= target_points:
                best_result = [[float(x), float(y)] for x, y in coords]
                high = mid
            else:
                low = mid

            if num_points <= target_points and num_points >= min_points:
                break

        return best_result

    def predict(
        self,
        image_path: str,
        points: List[List[float]],
        point_labels: List[int],
        mask_input: Optional[List[List[float]]] = None,
        multimask_output: bool = False,
    ) -> Dict[str, Any]:
        """
        Run SAM2 prediction with point prompts.

        Args:
            image_path: Path to the image file
            points: List of [x, y] point coordinates
            point_labels: List of labels (1=foreground, 0=background)
            mask_input: Optional low-res mask for refinement
            multimask_output: Whether to return multiple masks

        Returns:
            Dict with polygon, bounds, score, and low_res_mask
        """
        import torch

        self._ensure_model_loaded()

        if not points:
            raise ValueError("At least one point is required")

        if len(points) != len(point_labels):
            raise ValueError("points and point_labels must have same length")

        with self._model_lock:
            # Load image if different from cached
            if self._current_image_path != image_path:
                logger.debug(f"Loading image: {image_path}")
                imdata = self._load_image(image_path)
                self.predictor.set_image(imdata)
                self._current_image_path = image_path

            # Prepare prompts
            point_coords = np.array(points, dtype=np.float32)
            point_labels_arr = np.array(point_labels, dtype=np.int32)

            # Prepare mask input if provided
            mask_input_arr = None
            if mask_input is not None:
                mask_input_arr = np.array(mask_input, dtype=np.float32)
                if len(mask_input_arr.shape) == 2:
                    mask_input_arr = mask_input_arr[None, :, :]

            # Run inference
            if self.predictor.device.type == 'cuda':
                autocast_context = torch.autocast(
                    self.predictor.device.type, dtype=torch.bfloat16
                )
            else:
                autocast_context = contextlib.nullcontext()

            with torch.inference_mode(), autocast_context:
                masks, scores, low_res_masks = self.predictor.predict(
                    point_coords=point_coords,
                    point_labels=point_labels_arr,
                    mask_input=mask_input_arr,
                    multimask_output=multimask_output,
                )

        # Select best mask
        if multimask_output:
            best_idx = np.argmax(scores)
            mask = masks[best_idx]
            score = float(scores[best_idx])
            low_res_mask = low_res_masks[best_idx]
        else:
            mask = masks[0]
            score = float(scores[0])
            low_res_mask = low_res_masks[0]

        # Convert mask to polygon
        polygon, bounds = self._mask_to_polygon(mask)

        # Adaptively simplify polygon based on shape complexity
        if polygon and len(polygon) > 4:
            polygon = self._adaptive_simplify_polygon(
                polygon, self.max_polygon_points, min_points=4
            )

        return {
            "success": True,
            "polygon": polygon,
            "bounds": bounds,
            "score": score,
            "low_res_mask": low_res_mask.tolist(),
            "mask_shape": list(mask.shape),
        }

    def set_image(self, image_path: str) -> None:
        """Pre-load an image for multiple predictions."""
        self._ensure_model_loaded()

        with self._model_lock:
            logger.debug(f"Pre-loading image: {image_path}")
            imdata = self._load_image(image_path)
            self.predictor.set_image(imdata)
            self._current_image_path = image_path

    def clear_image(self) -> None:
        """Clear the cached image."""
        with self._model_lock:
            if self.predictor is not None:
                self.predictor.reset_predictor()
            self._current_image_path = None

    def is_available(self) -> bool:
        """Check if SAM2 is available (can be imported)."""
        try:
            import sam2  # noqa: F401
            return True
        except ImportError:
            return False

    def is_loaded(self) -> bool:
        """Check if the model is currently loaded."""
        return self.predictor is not None


def get_sam2_service() -> SAM2Service:
    """Get the singleton SAM2 service instance."""
    return SAM2Service()
