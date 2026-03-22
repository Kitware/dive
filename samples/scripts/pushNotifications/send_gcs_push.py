#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
#     "requests",
# ]
# ///
import click
import requests
import json
from datetime import datetime, timezone
import base64
import uuid


def build_payload(bucket_id: str, object_id: str, event_type: str = "OBJECT_FINALIZE") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    fake_data = base64.b64encode(b"{}\n").decode("utf-8")
    return {
        "message": {
            "attributes": {
                "bucketId": bucket_id,
                "objectId": object_id,
                "eventType": event_type,
            },
            "data": fake_data,
            "messageId": str(uuid.uuid4()),
            "publishTime": now,
        },
        "subscription": "local-testing",
    }


@click.command()
@click.option("--server", default="http://localhost:8010", show_default=True, help="DIVE server base URL")
@click.option("--bucket", default="dive-sample-data", required=True, help="Bucket name as configured in assetstore")
@click.option("--object", "object_path", required=True, help="Object path that was finalized")
def main(server, bucket, object_path):
    url = f"{server}/api/v1/bucket_notifications/gcs"
    payload = build_payload(bucket, object_path)
    resp = requests.post(url, json={"message": payload["message"], "subscription": payload["subscription"]})
    click.echo(f"POST {url} -> {resp.status_code}")
    if resp.status_code >= 400:
        click.echo(resp.text)


if __name__ == "__main__":
    main()


