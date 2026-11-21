"""Run inside VIAME's Python environment, once per web query job."""

import hashlib
import json
from pathlib import Path
import sys


def result_key(result):
    """Stable across worker processes; live service instance ids are not."""
    identity = [
        result['session'],
        result['stream_id'],
        result.get('start_frame'),
        result.get('end_frame'),
        result.get('tracks', []),
    ]
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def execute_query(service, request):
    service.handle_request(
        {
            'command': 'open_index',
            'index_dirs': request['indexDirs'],
            'backend': 'files',
        }
    )
    response = service.handle_request(
        {
            'command': 'formulate_query',
            'image_path': request['imagePath'],
            'boxes': request['boxes'] or None,
        }
    )
    if not response.get('results'):
        response = service.handle_request({'command': 'process_query'})
    for feedback in request.get('feedback', []):
        refs = {result_key(result): result['ref'] for result in response.get('results', [])}
        try:
            positives = [refs[key] for key in feedback['positive']]
            negatives = [refs[key] for key in feedback['negative']]
        except KeyError as exc:
            raise ValueError(
                'A reviewed result could not be reproduced; start a new search.'
            ) from exc
        response = service.handle_request(
            {
                'command': 'refine',
                'positive_ids': positives,
                'negative_ids': negatives,
            }
        )
    for result in response.get('results', []):
        result['key'] = result_key(result)
        result['datasetId'] = request['datasetIds'][result['session']]
        result.pop('index_dir', None)
    # Feedback requests also carry worker-local paths; only return the public result schema.
    return {'results': response.get('results', [])}


def main():
    from viame.core.query_service import QueryService

    request = json.loads(Path(sys.argv[1]).read_text())
    service = QueryService(None)
    try:
        response = execute_query(service, request)
        Path(sys.argv[2]).write_text(json.dumps(response))
    finally:
        service.handle_request({'command': 'close_index'})


if __name__ == '__main__':
    main()
