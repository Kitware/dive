"""Stands in for viame.core.interactive_service in tests: JSON lines in, JSON lines out."""
import json
import sys
import threading
import time

sys.stderr.write('Service started, waiting for requests...\n')
sys.stderr.flush()
lock = threading.Lock()


def send(message):
    with lock:
        sys.stdout.write(json.dumps(message) + '\n')
        sys.stdout.flush()


def later(delay, message):
    def run():
        time.sleep(delay)
        send(message)
    threading.Thread(target=run, daemon=True).start()


for raw in sys.stdin:
    request = json.loads(raw)
    command = request.get('command')
    rid = request.get('id')
    if command == 'shutdown':
        send({'id': rid, 'success': True})
        break
    if command == 'sleep':
        time.sleep(float(request.get('seconds', 0.5)))
        send({'id': rid, 'success': True, 'slept': True})
    elif command == 'set_frame':
        send({'id': rid, 'success': True, 'disparity_ready': False})
        later(0.1, {'id': rid, 'type': 'disparity_ready', 'success': True})
    elif command == 'deferred':
        later(0.2, {'id': rid, 'success': True, 'deferred': True})
    elif command == 'crash':
        sys.exit(3)
    else:
        send({'id': rid, 'success': True, 'echo': {k: v for k, v in request.items() if k not in ('id', 'command')}})
