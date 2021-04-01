from dive_server import viame, viame_detection, viame_summary
from dive_tasks import summary, tasks
from dive_utils import constants, models, types


def test_smoke_import():
    """
    Smoke test verifies that imports imports work properly.
    - without circular import errors
    - without any issues in module `__init__`
    """
    pass
