"""Scoring mode constants shared by the REST layer and the worker task.

Mirrors client/dive-common/scoring/{types,metrics}.ts; keep the two in step.
"""

import math
from typing import Any, Dict, Optional

SCORING_RESULT_VERSION = 1

# Item metadata key carrying the ScoringResultSummary for a persisted result.
SCORING_RESULT_META = 'scoringResult'

DEFAULT_SCORING_PARAMS: Dict[str, Any] = {
    'iouThreshold': 0.5,
    'confidenceThreshold': 0.0,
    'matchMode': 'box',
    'perClass': True,
    'topClass': False,
    'auxConfidence': False,
    'tracking': True,
    'keypointThreshold': 0.1,
    'sweep': True,
    'sweepInterval': 50,
    'filterEstimator': 'min',
    'defaultLabel': '',
    'labelSynonyms': '',
}

HEADLINE_METRIC_KEYS = [
    'precision',
    'recall',
    'f1_score',
    'average_precision',
    'ap50',
    'mean_ap',
    'mota',
    'idf1',
    'hota',
    'mean_iou',
    'mean_polygon_iou',
    'keypoint_pck',
    'length_mape',
    'true_positives',
    'false_positives',
    'false_negatives',
]


def _as_number_or_none(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return None
    return value


def headline_metrics(raw: Dict[str, Any]) -> Dict[str, Optional[float]]:
    return {key: _as_number_or_none(raw[key]) for key in HEADLINE_METRIC_KEYS if key in raw}


def result_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    """The ScoringResultSummary fields of a ScoringResultFile, minus ``id``."""
    return {
        'created': result['created'],
        'title': result['title'],
        'datasetId': result['datasetId'],
        'pairs': result['pairs'],
        'params': result['params'],
        'headline': headline_metrics(result.get('metrics') or {}),
    }
