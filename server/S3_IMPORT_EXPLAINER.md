# S3 / assetstore import behavior: Girder 3 vs Girder 5 (and DIVE)

This document explains why DIVE’s assetstore import integration had to change when moving to **Girder 5**, and how the current design works. It is aimed at maintainers debugging imports, batch postprocess, or bucket notifications.

## Girder 3 (older): import ran in the web server process

In typical Girder 3 deployments, **importing existing data from an S3-backed assetstore** was driven from the **same process that served the Girder API** (CherryPy / WSGI). Roughly:

1. A client called the assetstore import REST endpoint.
2. The request handler eventually called **`Assetstore().importData(...)`** in that process.
3. The S3 adapter listed keys and created items/files, firing events such as **`s3_assetstore_imported`** for each object.
4. Girder **plugins** (including DIVE’s `dive_server`) were loaded in that same process, so any **`events.bind(...)`** in `GirderPlugin.load()` saw those events.

So for DIVE on Girder 3, it was enough to register handlers in **`dive_server`** for:

- **`s3_assetstore_imported`** / **`filesystem_assetstore_imported`** (per-item metadata, folder typing, etc.)
- Optional REST hooks around **`rest.post.assetstore/:id/import`** if you needed request-scoped behavior

Everything ran **co-located** with the plugin loader.

## Girder 5: import runs on a Celery worker (`local` queue)

In **Girder 5**, the assetstore import REST handler **does not** call `Assetstore().importData()` in the web process. It enqueues a Celery task, e.g. **`importDataTask`**, on the **`local`** queue (see Girder’s `girder/api/v1/assetstore.py` and `girder/tasks.py`).

Implications:

| Concern | Girder 3 (typical) | Girder 5 |
|--------|---------------------|----------|
| Where `importData` runs | Web server process | **Celery worker** (`local`) |
| Where `s3_assetstore_imported` fires | Same process as `dive_server` | **Worker process** (no `dive_server` plugin load) |
| REST `import` handler duration | Could be long (sync work) | Short (enqueue + return) |
| When `rest.post...import.after` runs | After import if sync | **Right after enqueue**, before import finishes |

So **plugin `events.bind` in `dive_server` only applies to the Girder web process**. It does **not** run inside the Celery worker that executes `importDataTask`. Handlers bound only in `dive_server` **never see** per-file import events for the normal admin import path.

That is the core regression class: **same event names, different process**.

## REST `import.before` / `import.after` are the wrong lifecycle for async import

Girder still wraps REST routes with events like:

- `rest.post.assetstore/:id/import.before`
- `rest.post.assetstore/:id/import.after`

For Girder 5’s async import, **`.after` fires when the HTTP handler returns**, i.e. after **`importDataTask.delay(...)`**, not after the worker finishes importing. Any “post-import” work tied only to REST `.after` runs **too early** (empty or partial tree).

Model-level events are a better match for “import finished”:

- **`assetstore_import.after`** — triggered at the end of **`Assetstore().importData`** in **`girder/models/assetstore.py`**, in **whichever process** ran import (here: the worker).

DIVE’s post-import steps (dangling annotations, batch postprocess kickoff) are wired to **`assetstore_import.after`** on the worker, not to REST `.after`.

## Why `dive_tasks/worker_girder_events.py` exists

**`girder_worker`** discovers task modules via entry points (`girder_worker_plugins`); it does **not** load full Girder server plugins.

DIVE registers a small bootstrap module that runs when the worker starts:

- Binds **`s3_assetstore_imported`**, **`filesystem_assetstore_imported`**, **`assetstore_import.after`** to the same functions as before (`dive_server/event.py`).
- Binds **`jobs.schedule`** → **`scheduleLocal`** from **`girder_jobs`**, because **`Job().scheduleJob`** only *emits an event*; without the Jobs plugin loaded in the worker, **local jobs would never start** if something called `scheduleJob` from a task.

This file is loaded early via **`dive_tasks/__init__.py`** → **`task_imports`**.

## Batch postprocess: local job + daemon thread vs Celery task

Historically DIVE used **`Job().createLocalJob`** + **`Job().scheduleJob`**, with an entrypoint that starts a **daemon thread** (same pattern as **Slicer CLI Web** batch jobs on the **web server**).

Problems when the **parent import** already runs on a **`local` Celery worker**:

1. **`scheduleLocal`** was only guaranteed on the **web** process unless also bound on the worker (see above).
2. Even with **`scheduleLocal`**, starting a **daemon thread** at the tail of **`importDataTask`** is fragile: the import task returns, worker lifecycle / threading makes it easy for the job to **never reach RUNNING** or for work to be cut off.

The robust fix is to enqueue **`run_batch_postprocess_job`** on the **`local`** queue (**`dive_tasks/local_tasks.py`**): a normal Celery task loads the Girder job document and runs **`batch_postprocess_task`** synchronously inside that task.

## Bucket notifications (GCS) and `force_recursive`

**`bucket_notifications`** previously called **`Assetstore().importData(..., force_recursive=False)`** **inside the web handler**. That is correct for **incremental** object notifications (avoid re-walking huge subtrees on every push) but **blocks** the HTTP thread and risks Pub/Sub timeouts.

Girder’s stock **`importDataTask`** does **not** pass **`force_recursive`**; the S3 adapter defaults to **`force_recursive=True`**, which would **change semantics** for incremental notifications.

DIVE therefore uses **`import_assetstore_path_async`** (**`local_tasks.py`**), which forwards **`force_recursive=False`** (and enqueues on **`local`** so the push handler returns quickly).

## What was removed from `dive_server` and why

With **all** DIVE-driven **`importData`** paths going through **`local`** workers (admin **`importDataTask`** + **`import_assetstore_path_async`**), events fire only there. Duplicate **`events.bind`** in **`dive_server/__init__.py`** for assetstore imports was redundant and confusing, so it was removed. **`model.user.save.created`** and the rest of the plugin are unchanged.

If you add **new** code that calls **`Assetstore().importData`** **in the Girder web process**, you must either:

- Route that work through **`import_assetstore_path_async`** (or another **`local`** task), **or**
- Re-bind the assetstore handlers in **`dive_server`** for that path.

## File map (quick reference)

| Piece | Role |
|-------|------|
| `dive_tasks/worker_girder_events.py` | Register Girder **`events.bind`** in Celery worker processes |
| `dive_tasks/local_tasks.py` | **`local`** queue: batch postprocess job runner, bucket **`importData`** with **`force_recursive`** |
| `dive_server/event.py` | **`process_s3_import`**, **`process_fs_import`**, **`run_post_assetstore_import`** (handlers; bound from worker) |
| `bucket_notifications/views.py` | Enqueues **`import_assetstore_path_async.delay(...)`** |
| `dive_server/__init__.py` | No assetstore import binds (by design); plugins + routes only |

## Summary

- **Girder 5** moved heavy **`importData`** work off the web server onto **`importDataTask`** (**`local`** queue).
- **Server plugins** do not load in that worker, so **worker-side event registration** is required for DIVE metadata and post-import behavior.
- **REST import `.after`** is not a substitute for **`assetstore_import.after`** when import is async.
- **Batch postprocess** should run as a **dedicated `local` Celery task**, not only as a daemon thread off **`importDataTask`**.
- **Bucket notifications** should enqueue import on **`local`** and preserve **`force_recursive=False`**, not use raw **`importDataTask`**.

This set of changes aligns DIVE with Girder 5’s process model while preserving the same product behavior as on Girder 3.
