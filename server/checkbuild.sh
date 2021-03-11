#!/bin/bash
black .
isort .
mypy .
pytest tests/
