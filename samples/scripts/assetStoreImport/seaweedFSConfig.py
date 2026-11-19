# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "boto3",
#     "click",
# ]
# ///
import json
import subprocess
import time
from pathlib import Path

import boto3
import click
from botocore.exceptions import BotoCoreError, ClientError

AccessKey = "OMKF2I2NOD7JGYZ9XHE3"
SecretKey = "xbze+fJ6Wrfplq17JjSCZZJSz7AxEwRWm1MZXH2O"

SEAWEEDFS_CONTAINER = "seaweedfs_server"
NETWORK_NAME = "dive_default"
CONFIG_DIR = Path(__file__).resolve().parent / ".seaweedfs"


def get_container_ip(container_name: str, network_name: str) -> str:
    result = subprocess.run(
        ["docker", "inspect", container_name],
        capture_output=True,
        text=True,
        check=True
    )
    info = json.loads(result.stdout)
    # Navigate to the network you care about
    ip_address = info[0]["NetworkSettings"]["Networks"][network_name]["IPAddress"]
    return ip_address


def write_s3_config() -> Path:
    """Write the SeaweedFS S3 identity file granting the sample access key full access."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    config_path = CONFIG_DIR / "s3.json"
    config = {
        "identities": [
            {
                "name": "dive",
                "credentials": [{"accessKey": AccessKey, "secretKey": SecretKey}],
                "actions": ["Admin", "Read", "List", "Tagging", "Write"],
            }
        ]
    }
    config_path.write_text(json.dumps(config, indent=2))
    return config_path


def wait_for_s3(s3, timeout: int = 60):
    deadline = time.time() + timeout
    while True:
        try:
            s3.list_buckets()
            return
        except (BotoCoreError, ClientError):
            if time.time() > deadline:
                raise click.ClickException("SeaweedFS S3 API did not become ready in time.")
            time.sleep(1)


@click.command()
@click.option('--data-dir', '-d', default='./sample', show_default=True,
              type=click.Path(file_okay=False), help="Folder to host in SeaweedFS bucket")
@click.option('--api-port', default=8333, show_default=True,
              help="Port for S3 API access")
@click.option('--filer-port', default=8888, show_default=True,
              help="Port for SeaweedFS Filer UI access")
@click.option('--image', default='chrislusf/seaweedfs:latest', show_default=True,
              help="SeaweedFS docker image to run")
def main(data_dir, api_port, filer_port, image):
    """
    Launch SeaweedFS with an S3 gateway, configure a bucket and access key, and upload sample data.
    """
    data_dir = Path(data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    # Stop/remove existing container
    subprocess.run(["docker", "rm", "-f", SEAWEEDFS_CONTAINER],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Create a shared Docker network
    subprocess.run(["docker", "network", "create", NETWORK_NAME],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    config_path = write_s3_config()

    # Start SeaweedFS (master + volume + filer + S3 gateway in one container)
    click.echo(f"🚀 Starting SeaweedFS server ({image})")
    subprocess.run([
        "docker", "run", "-d",
        "--name", SEAWEEDFS_CONTAINER,
        "--network", NETWORK_NAME,
        "-p", f"{api_port}:8333",
        "-p", f"{filer_port}:8888",
        "-v", f"{config_path}:/etc/seaweedfs/s3.json:ro",
        image,
        "server", "-dir=/data", "-s3", "-s3.port=8333",
        "-s3.config=/etc/seaweedfs/s3.json",
    ], check=True)

    localhost = "localhost"
    s3 = boto3.client(
        "s3",
        endpoint_url=f"http://{localhost}:{api_port}",
        aws_access_key_id=AccessKey,
        aws_secret_access_key=SecretKey,
        region_name="us-east-1",
    )

    click.echo("⏳ Waiting for SeaweedFS S3 API to start...")
    wait_for_s3(s3)

    # Create a bucket
    bucket_name = "dive-sample-data"
    existing_buckets = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
    if bucket_name in existing_buckets:
        click.echo(f"🗃️ Bucket {bucket_name} already exists, skipping creation.")
    else:
        click.echo(f"🗃️ Creating bucket: {bucket_name} ...")
        s3.create_bucket(Bucket=bucket_name)

    # Load sample data into bucket
    click.echo(f"📂 Uploading sample data from {data_dir} to bucket...")
    files = [p for p in sorted(data_dir.rglob("*")) if p.is_file()]
    for path in files:
        s3.upload_file(str(path), bucket_name, path.relative_to(data_dir).as_posix())
    click.echo(f"   Uploaded {len(files)} files.")

    # Smoke test the credentials
    click.echo("🧪 Running smoke test with access key...")
    try:
        s3.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
        click.echo("✅ Smoke test passed! Access key works.")
    except (BotoCoreError, ClientError):
        click.echo("❌ Smoke test failed! Could not use access key.")

    seaweedfs_ip = get_container_ip(SEAWEEDFS_CONTAINER, NETWORK_NAME)
    click.echo("\n✅ SeaweedFS setup complete!\n")
    click.echo(f"  Filer UI: http://{localhost}:{filer_port}")
    click.echo(f"  S3 API:  http://{SEAWEEDFS_CONTAINER}:8333")
    click.echo(f"  S3 API:  http://{seaweedfs_ip}:8333")
    click.echo(f"  Bucket: {bucket_name}")
    click.echo(f"  Access key: {AccessKey}")
    click.echo(f"  Secret key: {SecretKey}")


if __name__ == "__main__":
    main()
