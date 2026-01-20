"""
Stereo Interactive Service for Web (Girder)

Provides a singleton stereo service for interactive stereo annotation.
When in stereo mode, the service proactively computes disparity maps when the user
navigates to new frames, so line transfers are instant when annotations are drawn.

Unlike SAM2, this service:
1. Proactively computes disparity when frame changes (not on user action)
2. Supports cancellation when navigating away from a frame
3. Can be enabled/disabled by the user
4. Requires calibration data from the dataset

Uses Foundation Stereo model internally for disparity computation.
"""

import contextlib
import json
import logging
import os
import threading
import queue
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class StereoService:
    """
    Singleton stereo service for interactive stereo annotation.

    Thread-safe with lazy initialization of the model.
    Uses Foundation Stereo model internally for disparity computation.
    """

    _instance: Optional['StereoService'] = None
    _lock = threading.Lock()

    def __new__(cls) -> 'StereoService':
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, '_initialized', False):
            return

        self._model = None
        self._InputPadder = None
        self._torch_device = None
        self._model_lock = threading.Lock()

        # Service state
        self._enabled = False

        # Configuration
        self.checkpoint = None
        self.config_path = ""
        self.vit_size = "vits"
        self.device = "cuda"
        self.scale = 0.25
        self.use_half_precision = True
        self.num_iters = 32

        # Calibration
        self._calibration: Optional[Dict] = None
        self._focal_length = 0.0
        self._baseline = 0.0
        self._principal_x = 0.0
        self._principal_y = 0.0

        # Current frame state
        self._current_left_path: Optional[str] = None
        self._current_right_path: Optional[str] = None
        self._current_disparity: Optional[np.ndarray] = None
        self._disparity_ready = False
        self._computing = False

        # Background computation
        self._compute_thread: Optional[threading.Thread] = None
        self._cancel_event = threading.Event()
        self._compute_queue: queue.Queue = queue.Queue()

        self._initialized = True

    def _find_checkpoint(self) -> Optional[str]:
        """Find the Foundation Stereo checkpoint in standard locations."""
        viame_install = os.environ.get("VIAME_INSTALL")
        if viame_install:
            checkpoint = Path(viame_install) / "configs" / "pipelines" / "models" / "foundation_stereo_s.pth"
            if checkpoint.exists():
                return str(checkpoint)

        # Try relative to this file
        this_dir = Path(__file__).parent
        possible_paths = [
            this_dir / ".." / ".." / ".." / ".." / "configs" / "pipelines" / "models" / "foundation_stereo_s.pth",
            this_dir / ".." / ".." / ".." / ".." / ".." / "configs" / "pipelines" / "models" / "foundation_stereo_s.pth",
        ]
        for p in possible_paths:
            if p.exists():
                return str(p.resolve())

        return None

    def _ensure_model_loaded(self) -> None:
        """Load the Foundation Stereo model if not already loaded."""
        if self._model is not None:
            return

        with self._model_lock:
            if self._model is not None:
                return

            try:
                import torch
                import sys

                logger.info("Loading Foundation Stereo model...")

                # Find checkpoint if not specified
                if not self.checkpoint:
                    self.checkpoint = self._find_checkpoint()
                    if not self.checkpoint:
                        raise RuntimeError("Foundation Stereo checkpoint not found. Set VIAME_INSTALL or specify checkpoint path.")

                logger.info(f"  Checkpoint: {self.checkpoint}")
                logger.info(f"  ViT Size: {self.vit_size}")
                logger.info(f"  Device: {self.device}")
                logger.info(f"  Scale: {self.scale}")

                # Add foundation-stereo to path
                foundation_stereo_dir = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
                    'pytorch-libs', 'foundation-stereo'
                )
                if foundation_stereo_dir not in sys.path:
                    sys.path.insert(0, foundation_stereo_dir)

                from omegaconf import OmegaConf
                from core.foundation_stereo import FoundationStereo as FoundationStereoModel
                from core.utils.utils import InputPadder

                self._InputPadder = InputPadder

                # Load model configuration
                if self.config_path and os.path.exists(self.config_path):
                    model_cfg = OmegaConf.load(self.config_path)
                else:
                    ckpt_dir = os.path.dirname(self.checkpoint)
                    cfg_path = os.path.join(ckpt_dir, 'cfg.yaml')
                    if os.path.exists(cfg_path):
                        model_cfg = OmegaConf.load(cfg_path)
                    else:
                        model_cfg = OmegaConf.create({})

                model_cfg['vit_size'] = self.vit_size

                # Create and load model
                self._model = FoundationStereoModel(model_cfg)
                ckpt = torch.load(self.checkpoint, map_location='cpu', weights_only=False)
                self._model.load_state_dict(ckpt['model'])

                # Setup device
                device_str = self.device
                if device_str == 'auto':
                    device_str = 'cuda:0' if torch.cuda.is_available() else 'cpu'
                self._torch_device = torch.device(device_str)
                self._model.to(self._torch_device)

                if self.use_half_precision and 'cuda' in device_str:
                    self._model.half()
                self._model.eval()

                torch.set_grad_enabled(False)

                logger.info("Foundation Stereo model loaded successfully")

            except ImportError as e:
                logger.error(f"Foundation Stereo not available: {e}")
                raise RuntimeError(
                    "Foundation Stereo is not installed. Enable VIAME_ENABLE_PYTORCH-FOUNDATION-STEREO in your build."
                ) from e
            except Exception as e:
                logger.error(f"Failed to load Foundation Stereo model: {e}")
                raise

    def _unload_model(self) -> None:
        """Unload the model and free GPU memory."""
        with self._model_lock:
            if self._model is None:
                return

            try:
                import torch
                self._model = None
                self._InputPadder = None
                self._torch_device = None
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                logger.info("Foundation Stereo model unloaded")
            except Exception as e:
                logger.error(f"Error unloading model: {e}")

    def _load_image(self, image_path: str) -> np.ndarray:
        """Load image from path and return as numpy array."""
        from PIL import Image
        img = Image.open(image_path).convert("RGB")
        return np.array(img)

    def _compute_disparity_sync(
        self,
        left_path: str,
        right_path: str,
    ) -> Optional[np.ndarray]:
        """Compute disparity for stereo pair synchronously."""
        import torch
        import cv2

        if self._cancel_event.is_set():
            return None

        left_npy = self._load_image(left_path)
        right_npy = self._load_image(right_path)

        if self._cancel_event.is_set():
            return None

        if left_npy.shape != right_npy.shape:
            raise RuntimeError(
                f"Left and right image dimensions must match: {left_npy.shape} vs {right_npy.shape}"
            )

        H_orig, W_orig = left_npy.shape[:2]

        if self.scale < 1.0:
            H_scaled = int(H_orig * self.scale)
            W_scaled = int(W_orig * self.scale)
            left_npy = cv2.resize(left_npy, (W_scaled, H_scaled), interpolation=cv2.INTER_AREA)
            right_npy = cv2.resize(right_npy, (W_scaled, H_scaled), interpolation=cv2.INTER_AREA)
            H, W = H_scaled, W_scaled
        else:
            H, W = H_orig, W_orig

        if self._cancel_event.is_set():
            return None

        use_half = self.use_half_precision and 'cuda' in str(self._torch_device)

        with self._model_lock:
            left_tensor = torch.as_tensor(left_npy).to(self._torch_device)
            left_tensor = left_tensor.half() if use_half else left_tensor.float()
            left_tensor = left_tensor[None].permute(0, 3, 1, 2)
            right_tensor = torch.as_tensor(right_npy).to(self._torch_device)
            right_tensor = right_tensor.half() if use_half else right_tensor.float()
            right_tensor = right_tensor[None].permute(0, 3, 1, 2)

            if self._cancel_event.is_set():
                return None

            padder = self._InputPadder(left_tensor.shape, divis_by=32, force_square=False)
            left_padded, right_padded = padder.pad(left_tensor, right_tensor)

            if self._cancel_event.is_set():
                return None

            with torch.amp.autocast('cuda', enabled=True):
                disp = self._model.forward(
                    left_padded, right_padded,
                    iters=self.num_iters,
                    test_mode=True,
                    low_memory=True
                )

            if self._cancel_event.is_set():
                return None

            disp = padder.unpad(disp.float())
            disp_npy = disp.data.cpu().numpy().reshape(H, W)

        if self.scale < 1.0:
            disp_npy = cv2.resize(disp_npy, (W_orig, H_orig), interpolation=cv2.INTER_LINEAR)
            disp_npy = disp_npy / self.scale

        return disp_npy

    def _background_compute_worker(self) -> None:
        """Background thread that processes disparity computation requests."""
        while True:
            try:
                task = self._compute_queue.get(timeout=0.5)
            except queue.Empty:
                continue

            if task is None:
                break

            left_path, right_path = task

            try:
                self._cancel_event.clear()
                self._computing = True
                logger.debug(f"Starting disparity computation for {left_path}")

                disparity = self._compute_disparity_sync(left_path, right_path)

                if disparity is not None and not self._cancel_event.is_set():
                    if (self._current_left_path == left_path and
                            self._current_right_path == right_path):
                        self._current_disparity = disparity
                        self._disparity_ready = True
                        logger.debug(f"Disparity ready for {left_path}")
                else:
                    logger.debug("Disparity computation cancelled")

            except Exception as e:
                logger.error(f"Error computing disparity: {e}")

            self._computing = False
            self._compute_queue.task_done()

    def _start_background_worker(self) -> None:
        """Start the background computation worker thread."""
        if self._compute_thread is None or not self._compute_thread.is_alive():
            self._compute_thread = threading.Thread(
                target=self._background_compute_worker,
                daemon=True
            )
            self._compute_thread.start()

    def _cancel_computation(self) -> None:
        """Cancel any ongoing disparity computation."""
        self._cancel_event.set()
        while not self._compute_queue.empty():
            try:
                self._compute_queue.get_nowait()
                self._compute_queue.task_done()
            except queue.Empty:
                break

    def set_calibration(self, calibration: Dict[str, Any]) -> None:
        """Set calibration parameters for depth computation."""
        self._calibration = calibration
        self._focal_length = float(calibration.get('fx_left', 0.0))
        self._principal_x = float(calibration.get('cx_left', 0.0))
        self._principal_y = float(calibration.get('cy_left', 0.0))

        T = calibration.get('T', [0.0, 0.0, 0.0])
        if isinstance(T, list) and len(T) >= 3:
            self._baseline = abs(T[0])
            if self._baseline < 1e-6:
                self._baseline = np.sqrt(T[0]**2 + T[1]**2 + T[2]**2)
        else:
            self._baseline = 0.0

        logger.info(f"Set calibration: focal_length={self._focal_length}, "
                    f"baseline={self._baseline}")

    def enable(self, calibration: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Enable the stereo service.

        Args:
            calibration: Optional calibration data. Can be set later with set_calibration.

        Returns:
            Status dict with success flag
        """
        if self._enabled:
            return {"success": True, "message": "Already enabled"}

        try:
            if calibration:
                self.set_calibration(calibration)

            self._ensure_model_loaded()
            self._start_background_worker()
            self._enabled = True
            return {"success": True, "message": "Stereo service enabled"}

        except Exception as e:
            logger.exception("Failed to enable Foundation Stereo")
            return {"success": False, "error": str(e)}

    def disable(self) -> Dict[str, Any]:
        """Disable the stereo service and free resources."""
        if not self._enabled:
            return {"success": True, "message": "Already disabled"}

        self._cancel_computation()
        if self._compute_queue:
            self._compute_queue.put(None)

        self._unload_model()
        self._current_disparity = None
        self._disparity_ready = False
        self._current_left_path = None
        self._current_right_path = None
        self._enabled = False

        return {"success": True, "message": "Stereo service disabled"}

    def set_frame(
        self,
        left_image_path: str,
        right_image_path: str,
    ) -> Dict[str, Any]:
        """
        Set the current frame and start computing disparity proactively.

        This should be called when the user navigates to a new frame in stereo mode.
        Disparity computation starts immediately in the background.

        Args:
            left_image_path: Path to left stereo image
            right_image_path: Path to right stereo image

        Returns:
            Status dict with success flag and disparity_ready state
        """
        if not self._enabled:
            return {"success": False, "error": "Service not enabled"}

        if not os.path.exists(left_image_path):
            return {"success": False, "error": f"Left image not found: {left_image_path}"}
        if not os.path.exists(right_image_path):
            return {"success": False, "error": f"Right image not found: {right_image_path}"}

        # Check if already processing this frame
        if (self._current_left_path == left_image_path and
                self._current_right_path == right_image_path):
            if self._disparity_ready:
                return {"success": True, "disparity_ready": True, "message": "Disparity already computed"}
            else:
                return {"success": True, "disparity_ready": False, "message": "Computation in progress"}

        # Cancel current and start new
        self._cancel_computation()
        self._current_left_path = left_image_path
        self._current_right_path = right_image_path
        self._current_disparity = None
        self._disparity_ready = False

        self._compute_queue.put((left_image_path, right_image_path))

        return {"success": True, "disparity_ready": False, "message": "Computation started"}

    def get_status(self) -> Dict[str, Any]:
        """Get current service status."""
        return {
            "enabled": self._enabled,
            "disparity_ready": self._disparity_ready,
            "computing": self._computing,
            "current_left_path": self._current_left_path,
            "current_right_path": self._current_right_path,
            "has_calibration": self._calibration is not None,
            "model_loaded": self._model is not None,
        }

    def transfer_line(
        self,
        line: List[List[float]],
    ) -> Dict[str, Any]:
        """
        Transfer a line from left image to right image using disparity.

        Args:
            line: List of two [x, y] points defining the line

        Returns:
            Dict with transferred_line, original_line, and optional depth_info
        """
        if not self._enabled:
            return {"success": False, "error": "Service not enabled"}

        if not self._disparity_ready or self._current_disparity is None:
            return {"success": False, "error": "Disparity not ready"}

        if not line or len(line) != 2:
            return {"success": False, "error": "line must be a list of two [x, y] points"}

        p1, p2 = line
        H, W = self._current_disparity.shape

        def clamp_point(p):
            x = max(0, min(W - 1, int(round(p[0]))))
            y = max(0, min(H - 1, int(round(p[1]))))
            return x, y

        x1, y1 = clamp_point(p1)
        x2, y2 = clamp_point(p2)

        disp1 = float(self._current_disparity[y1, x1])
        disp2 = float(self._current_disparity[y2, x2])

        # For horizontal stereo: x_right = x_left - disparity
        x1_right = p1[0] - disp1
        x2_right = p2[0] - disp2

        transferred_line = [
            [float(x1_right), float(p1[1])],
            [float(x2_right), float(p2[1])],
        ]

        depth_info = None
        if self._focal_length > 0 and self._baseline > 0:
            depth1 = (self._focal_length * self._baseline) / max(disp1, 1e-6) if disp1 > 0 else None
            depth2 = (self._focal_length * self._baseline) / max(disp2, 1e-6) if disp2 > 0 else None
            depth_info = {
                "depth_point1": depth1,
                "depth_point2": depth2,
                "disparity_point1": disp1,
                "disparity_point2": disp2,
            }

        return {
            "success": True,
            "transferred_line": transferred_line,
            "original_line": line,
            "depth_info": depth_info,
        }

    def transfer_points(
        self,
        points: List[List[float]],
    ) -> Dict[str, Any]:
        """
        Transfer multiple points from left image to right image.

        Args:
            points: List of [x, y] points

        Returns:
            Dict with transferred_points, original_points, and disparity_values
        """
        if not self._enabled:
            return {"success": False, "error": "Service not enabled"}

        if not self._disparity_ready or self._current_disparity is None:
            return {"success": False, "error": "Disparity not ready"}

        if not points:
            return {"success": False, "error": "points is required"}

        H, W = self._current_disparity.shape
        transferred_points = []
        disparity_values = []

        for p in points:
            x = max(0, min(W - 1, int(round(p[0]))))
            y = max(0, min(H - 1, int(round(p[1]))))

            disp = float(self._current_disparity[y, x])
            x_right = p[0] - disp

            transferred_points.append([float(x_right), float(p[1])])
            disparity_values.append(disp)

        return {
            "success": True,
            "transferred_points": transferred_points,
            "original_points": points,
            "disparity_values": disparity_values,
        }

    def is_available(self) -> bool:
        """Check if Foundation Stereo is available (can be imported)."""
        try:
            import sys
            import os

            foundation_stereo_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
                'pytorch-libs', 'foundation-stereo'
            )
            if foundation_stereo_dir not in sys.path:
                sys.path.insert(0, foundation_stereo_dir)

            from core.foundation_stereo import FoundationStereo  # noqa: F401
            return True
        except ImportError:
            return False

    def is_enabled(self) -> bool:
        """Check if the service is currently enabled."""
        return self._enabled

    def is_disparity_ready(self) -> bool:
        """Check if disparity is ready for the current frame."""
        return self._disparity_ready


def get_stereo_service() -> StereoService:
    """Get the singleton stereo service instance."""
    return StereoService()
