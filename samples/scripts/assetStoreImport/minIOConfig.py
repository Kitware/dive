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

AccessKey = "OMKF2I2NOD7JGYZ9XHE3"
SecretKey = "xbze+fJ6Wrfplq17JjSCZZJSz7AxEwRWm1MZXH2O"


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


@click.command()
@click.option('--data-dir', '-d', default='./sample', show_default=True,
              type=click.Path(file_okay=False), help="Folder to host in MinIO bucket")
@click.option('--api-port', default=9000, show_default=True,
              help="Port for S3 API access")
@click.option('--console-port', default=9001, show_default=True,
              help="Port for MinIO Console access")
def main(data_dir, api_port, console_port):
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
        subprocess.run(["docker", "rm", "-f", c],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Create a shared Docker network
    subprocess.run(["docker", "network", "create", "dive_default"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Start MinIO server
    click.echo(f"🚀 Starting MinIO server with data dir: {data_dir}")
    subprocess.run([
        "docker", "run", "-d",
        "--name", minio_container,
        "--network", "dive_default",
        "-p", f"{api_port}:9000",
        "-p", f"{console_port}:9001",
        "-e", "MINIO_ROOT_USER=rootuser",
        "-e", "MINIO_ROOT_PASSWORD=rootpass123",
        "minio/minio",
        "server", "/data", "--console-address", ":9001"
    ], check=True)

    # Give MinIO time to start
    click.echo("⏳ Waiting for MinIO server to start...")
    time.sleep(5)

    mc_config_dir = Path.home() / ".mc"
    mc_config_dir.mkdir(parents=True, exist_ok=True)
    # Ensure ownership
    os.chown(mc_config_dir, uid, gid)

    # Start persistent mc container with config volume
    click.echo("⚙️ Starting persistent mc client container...")
    subprocess.run([
        "docker", "run", "-dit",
        "--name", mc_container,
        "--network", "dive_default",
        "-v", f"{data_dir}:/data",
        "--entrypoint=/bin/sh",
        "minio/mc",
    ], check=True)

    minio_ip = get_container_ip(minio_container, "dive_default")
    # Helper function: run mc inside persistent container
    def mc_cmd(*args, capture_output=False):
        result = subprocess.run(
            ["docker", "exec", mc_container, "mc", *args],
            check=True,
            text=True,
            capture_output=capture_output
        )
        return result.stdout if capture_output else None

    localhost = "localhost"
    # Configure alias for root user
    mc_cmd("alias", "set", "local", f"http://{minio_ip}:9000", "rootuser", "rootpass123")

    # Create a bucket
    bucket_name = "dive-sample-data"
    # check if bucket exists
    existing_buckets = mc_cmd("ls", "local", capture_output=True)
    if bucket_name in existing_buckets:
        click.echo(f"🗃️ Bucket {bucket_name} already exists, skipping creation.")
    else:
        click.echo(f"🗃️ Creating bucket: {bucket_name} ...")
        mc_cmd("mb", f"local/{bucket_name}")

    # Load sample data into bucket
    click.echo(f"📂 Uploading sample data from {data_dir} to bucket...")
    mc_cmd("cp", "-r", "/data/.", f"local/{bucket_name}")

    # Create a new access key under rootuser
    output = mc_cmd("admin", "accesskey", "ls", "local", "rootuser", capture_output=True)
    has_existing_key = False
    if output:
        lines = output.strip().splitlines()
        print(output)
        for line in lines:
            if "AccessKey" in line:
                parts = line.split()
                print(parts)
                has_existing_key = True

    if not has_existing_key:
        click.echo("🔑 Creating a new access key...")
        mc_cmd("admin", "accesskey", "create", "local", "rootuser", "--access-key", AccessKey, "--secret-key", SecretKey)

    # Smoke test the new credentials
    alias_name = "smoketest"
    click.echo("🧪 Running smoke test with new access key...")
    try:
        mc_cmd("alias", "set", alias_name, f"http://{minio_ip}:9000", AccessKey, SecretKey)
        mc_cmd("ls", alias_name)  # list buckets
        click.echo("✅ Smoke test passed! New access key works.")
    except subprocess.CalledProcessError:
        click.echo("❌ Smoke test failed! Could not use new access key.")

    # remove the smoketest alias
    mc_cmd("alias", "rm", alias_name)   
    # shutdown the client server
    subprocess.run(["docker", "stop", mc_container], check=True)
    subprocess.run(["docker", "rm", mc_container], check=True)
    click.echo(f"\n✅ MinIO setup complete!\n")
    click.echo(f"  Console: http://{localhost}:{console_port} (user: rootuser / rootpass123)")
    click.echo(f"  S3 API:  http://{minio_container}:{api_port}")
    click.echo(f"  S3 API:  http://{minio_ip}:{api_port}")
    click.echo(f"  Bucket: {bucket_name}")
    click.echo(f"  Persistent mc client running as container: {mc_container}")

if __name__ == "__main__":
    main()
