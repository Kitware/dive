/** Runs inside the installer process, including after Windows elevation. */
const addonRunner = String.raw`
import json, os, runpy, sys, threading, time, urllib.request

cancel_file = os.environ.get('VIAME_ADDON_CANCEL_FILE', '')
def cancelled():
    return cancel_file and os.path.exists(cancel_file)
def watch_cancel():
    while True:
        if cancelled():
            # Hard cancellation must also interrupt blocked network reads and extraction.
            os._exit(130)
        time.sleep(0.1)
if cancelled():
    sys.exit(130)
threading.Thread(target=watch_cancel, daemon=True).start()

installer = sys.argv.pop(1)
sys.argv[0] = installer
sys.path.insert(0, os.path.dirname(installer))
with open(installer, encoding='utf-8') as source:
    native_progress = 'VIAME_ADDON_PROGRESS' in source.read()

# Older installers suppress their terminal-only progress when launched by DIVE.
# Count actual response bytes without changing their download/checksum behavior.
if not native_progress:
    original_urlopen = urllib.request.urlopen
    class DownloadResponse:
        def __init__(self, response):
            self.response = response
            self.done = 0
            self.total = int(response.headers.get('Content-Length') or 0)
            self.last_update = 0
            self.report()
        def report(self, force=False):
            now = time.monotonic()
            if force or now - self.last_update >= 0.2 or self.done == self.total:
                print('VIAME_ADDON_PROGRESS ' + json.dumps(dict(
                    phase='download', done=self.done, total=self.total)), flush=True)
                self.last_update = now
        def read(self, *args, **kwargs):
            chunk = self.response.read(*args, **kwargs)
            self.done += len(chunk)
            self.report(force=not chunk)
            return chunk
        def __getattr__(self, name):
            return getattr(self.response, name)
        def __enter__(self):
            self.response.__enter__()
            return self
        def __exit__(self, *args):
            return self.response.__exit__(*args)
    def urlopen(*args, **kwargs):
        return DownloadResponse(original_urlopen(*args, **kwargs))
    urllib.request.urlopen = urlopen

runpy.run_path(installer, run_name='__main__')
`;

export default addonRunner;
