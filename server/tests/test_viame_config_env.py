from unittest import mock

from dive_tasks.viame_config import get_gpu_environment


def test_gpu_environment_drops_dive_venv():
    """VIAME must not inherit DIVE's venv: kwiver segfaults with VIRTUAL_ENV set."""
    worker_env = {
        "PATH": "/opt/dive/local/venv/bin:/usr/local/bin:/usr/bin",
        "VIRTUAL_ENV": "/opt/dive/local/venv",
        "UV_PYTHON": "3.11",
        "UV_PYTHON_INSTALL_DIR": "/opt/dive/local/uv-python",
        "KEEP_ME": "1",
    }
    with mock.patch.dict("os.environ", worker_env, clear=True), mock.patch(
        "dive_tasks.viame_config.getGPUs", return_value=[]
    ):
        env = get_gpu_environment()

    assert "VIRTUAL_ENV" not in env
    assert "UV_PYTHON" not in env
    assert "UV_PYTHON_INSTALL_DIR" not in env
    assert "/opt/dive/local/venv/bin" not in env["PATH"]
    assert env["KEEP_ME"] == "1"
