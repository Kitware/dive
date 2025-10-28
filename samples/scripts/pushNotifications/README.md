# Pub/Sub Bucket Notifications - Local Testing Plan

This folder contains scripts to locally test DIVE's bucket notification handling as implemented by the `bucket_notifications` plugin endpoints (`/api/v1/bucket_notifications/gcs` and routing API).

It provides:

- A MinIO setup script to stand up a local S3-compatible endpoint, create a bucket, and seed sample data (based on `samples/scripts/assetStoreImport/minIOConfig.py`).
- A script to modify bucket contents to simulate new data arriving (file uploads/overwrites/deletes) that should trigger re-imports when wired to notifications.
- A script to send mock GCS Pub/Sub push messages to the server endpoint for end-to-end testing without GCP.

## Background

See `docs/Deployment-Storage.md` → "S3 and MinIO Mirroring" and "Pub/Sub notifications". The server exposes:

- `POST /api/v1/bucket_notifications/gcs` for receiving push-delivered Pub/Sub messages. On OBJECT_FINALIZE, the server will locate a matching read-only S3/GCS assetstore and re-import the relevant path beneath the configured mount folder.
- `POST /api/v1/bucket_notifications/routing/:id` for configuring `notification_router_rules` on an assetstore (folder mount root).

Relevant server code: `server/bucket_notifications/views.py` and `server/bucket_notifications/models.py`.

## Prerequisites

- Docker installed and running
- Python 3.8+
- DIVE backend running and reachable (e.g., http://localhost:8010)
- An S3/MinIO assetstore configured in Girder Admin pointing to the MinIO bucket created by these scripts:
  - Type: Amazon S3
  - Service: `http://<minio-host>:9000` (use actual IP printed by setup script)
  - Bucket: `dive-sample-data`
  - Read only: checked
  - Region: `us-east-1` (or any string)
  - Access Key / Secret Key: values printed by setup script

After creating the assetstore, set notification routing via:

```bash
curl -X POST \
  -H "Girder-Token: <admin_token>" \
  -H "Content-Type: application/json" \
  http://localhost:8010/api/v1/bucket_notifications/routing/<assetstore_id> \
  -d '{"data": {"folderId": "<mount_root_folder_id>"}}'
```

## Scripts

1) setup_minio.py

Launches MinIO and seeds data into bucket `dive-sample-data`. Prints MinIO IP and test credentials. Adapted from `samples/scripts/assetStoreImport/minIOConfig.py`.

2) modify_bucket.py

Performs object operations to simulate new data arrival:
- Upload a new folder with images
- Overwrite an existing object
- Optionally delete an object

3) send_gcs_push.py

Sends a mock GCS Pub/Sub push payload to DIVE at `/api/v1/bucket_notifications/gcs` with `eventType=OBJECT_FINALIZE` targeting a given `bucketId` and `objectId`.

## End-to-End Test Flow

1. Run setup_minio.py to start MinIO and seed data.
2. Configure an S3 assetstore in Girder to point to the printed MinIO service and bucket.
3. Configure notification routing on that assetstore to point at your chosen mount root folder.
4. Run modify_bucket.py to upload new files or folders into the MinIO bucket.
5. For local-only testing, run send_gcs_push.py with matching bucket and object path to simulate Pub/Sub push. Example:

```bash
uv run --script setup_minio.py -d ./sample

uv run --script modify_bucket.py upload \
  --bucket dive-sample-data \
  --prefix new-sequence/ \
  --local-path ./newData

uv run --script send_gcs_push.py \
  --server http://localhost:8010 \
  --bucket dive-sample-data \
  --object "new-sequence/"
```

Check the DIVE UI: new datasets should appear or update under the configured mount folder as the server processes the import triggered by the notification.

## Notes

- The server only handles `OBJECT_FINALIZE` notifications for automatic imports.
- For true GCP testing, you can configure a Pub/Sub push subscription to `https://<server>/api/v1/bucket_notifications/gcs` as described in `docs/Deployment-Storage.md`.


