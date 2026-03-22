# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
# ]
# ///
import subprocess
import time
import click
import os
import json
from pathlib import Path


DEFAULT_ACCESS_KEY = "OMKF2I2NOD7JGYZ9XHE3"
DEFAULT_SECRET_KEY = "xbze+fJ6Wrfplq17JjSCZZJSz7AxEwRWm1MZXH2O"


def get_container_ip(container_name: str, network_name: str) -> str:
    result = subprocess.run(
        ["docker", "inspect", container_name], capture_output=True, text=True, check=True
    )
    info = json.loads(result.stdout)
    ip_address = info[0]["NetworkSettings"]["Networks"][network_name]["IPAddress"]
    return ip_address


@click.command()
@click.option(
    "--data-dir",
    "-d",
    default="../assetStoreImport/sample",
    show_default=True,
    type=click.Path(file_okay=False),
    help="Folder to host in MinIO bucket",
)
@click.option("--api-port", default=9000, show_default=True, help="Port for S3 API access")
@click.option(
    "--console-port", default=9001, show_default=True, help="Port for MinIO Console access"
)
@click.option("--bucket", default="dive-sample-data", show_default=True, help="Bucket name")
@click.option("--access-key", default=DEFAULT_ACCESS_KEY, show_default=True)
@click.option("--secret-key", default=DEFAULT_SECRET_KEY, show_default=True)
def main(data_dir, api_port, console_port, bucket, access_key, secret_key):
    """
    Launch MinIO and a persistent mc container, configure a bucket and user.
    """
    data_dir = Path(data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    minio_container = "minio_server"
    mc_container = "minio_client"

    uid = os.getuid()
    gid = os.getgid()

    # Stop/remove existing containers
    for c in [minio_container, mc_container]:
        subprocess.run(["docker", "rm", "-f", c], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Create a shared Docker network
    subprocess.run(["docker", "network", "create", "dive_default"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Start MinIO server
    click.echo(f"Starting MinIO server with data dir: {data_dir}")
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            minio_container,
            "--network",
            "dive_default",
            "-p",
            f"{api_port}:9000",
            "-p",
            f"{console_port}:9001",
            "-e",
            "MINIO_ROOT_USER=rootuser",
            "-e",
            "MINIO_ROOT_PASSWORD=rootpass123",
            "minio/minio",
            "server",
            "/data",
            "--console-address",
            ":9001",
        ],
        check=True,
    )

    # Give MinIO time to start
    click.echo("Waiting for MinIO server to start...")
    time.sleep(5)

    mc_config_dir = Path.home() / ".mc"
    mc_config_dir.mkdir(parents=True, exist_ok=True)
    os.chown(mc_config_dir, uid, gid)

    # Start persistent mc container with config volume
    click.echo("Starting persistent mc client container...")
    subprocess.run(
        [
            "docker",
            "run",
            "-dit",
            "--name",
            mc_container,
            "--network",
            "dive_default",
            "-v",
            f"{data_dir}:/data",
            "--entrypoint=/bin/sh",
            "minio/mc",
        ],
        check=True,
    )

    minio_ip = get_container_ip(minio_container, "dive_default")

    def mc_cmd(*args, capture_output=False):
        result = subprocess.run(
            ["docker", "exec", mc_container, "mc", *args],
            check=True,
            text=True,
            capture_output=capture_output,
        )
        return result.stdout if capture_output else None

    localhost = "localhost"
    # Configure alias for root user
    mc_cmd("alias", "set", "local", f"http://{minio_ip}:9000", "rootuser", "rootpass123")

    # Create a bucket
    existing_buckets = mc_cmd("ls", "local", capture_output=True) or ""
    if bucket in existing_buckets:
        click.echo(f"Bucket {bucket} already exists, skipping creation.")
    else:
        click.echo(f"Creating bucket: {bucket} ...")
        mc_cmd("mb", f"local/{bucket}")

    # Load sample data into bucket
    click.echo(f"Uploading sample data from {data_dir} to bucket...")
    mc_cmd("cp", "-r", "/data/.", f"local/{bucket}")

    # Create a new access key under rootuser if not present
    output = mc_cmd("admin", "accesskey", "ls", "local", "rootuser", capture_output=True) or ""
    has_existing_key = "AccessKey" in output
    if not has_existing_key:
        click.echo("Creating a new access key...")
        mc_cmd(
            "admin",
            "accesskey",
            "create",
            "local",
            "rootuser",
            "--access-key",
            access_key,
            "--secret-key",
            secret_key,
        )

    # Smoke test the new credentials
    alias_name = "smoketest"
    click.echo("Running smoke test with new access key...")
    try:
        mc_cmd("alias", "set", alias_name, f"http://{minio_ip}:9000", access_key, secret_key)
        mc_cmd("ls", alias_name)  # list buckets
        click.echo("Smoke test passed! New access key works.")
    except subprocess.CalledProcessError:
        click.echo("Smoke test failed! Could not use new access key.")

    # remove the smoketest alias and stop client
    mc_cmd("alias", "rm", alias_name)
    # subprocess.run(["docker", "stop", mc_container], check=True)
    # subprocess.run(["docker", "rm", mc_container], check=True)

    click.echo("\nMinIO setup complete!\n")
    click.echo(f"  Console: http://{localhost}:{console_port} (user: rootuser / rootpass123)")
    click.echo(f"  S3 API:  http://{minio_ip}:{api_port}")
    click.echo(f"  Bucket:  {bucket}")
    click.echo(f"  Access:  {access_key} / {secret_key}")


if __name__ == "__main__":
    main()


