#!/usr/bin/env python3
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "click",
# ]
# ///
import subprocess
import click
import os
import uuid


def mc_cmd(*args, capture_output=False):
    """Run mc command inside the minio_client container."""
    result = subprocess.run(
        ["docker", "exec", "minio_client", "mc", *args],
        check=True,
        text=True,
        capture_output=capture_output,
    )
    return result.stdout if capture_output else None


def docker_exec_mkdir(container_path):
    """Ensure a directory exists inside the container."""
    subprocess.run(
        ["docker", "exec", "minio_client", "mkdir", "-p", container_path],
        check=True,
    )


def docker_cp_to_container(local_path, container_path):
    """Copy a local file or directory into the minio_client container."""
    container_dir = os.path.dirname(container_path)
    docker_exec_mkdir(container_dir)
    subprocess.run(
        ["docker", "cp", local_path, f"minio_client:{container_path}"],
        check=True,
    )


def docker_exec_rm(container_path):
    """Remove temporary files/folders from inside the container."""
    subprocess.run(
        ["docker", "exec", "minio_client", "rm", "-rf", container_path],
        check=False,
    )


@click.group()
def cli():
    """CLI for managing MinIO bucket objects."""
    pass


@cli.command()
@click.option("--bucket", required=True, help="Bucket name, e.g., dive-sample-data")
@click.option("--prefix", required=True, help="Destination prefix inside the bucket")
@click.option("--local-path", required=True, type=click.Path(exists=True), help="Local folder or file to upload")
def upload(bucket, prefix, local_path):
    """Upload file/folder to bucket/prefix."""
    temp_id = uuid.uuid4().hex
    container_temp_path = f"/tmp/upload_{temp_id}"
    container_upload_path = os.path.join(container_temp_path, os.path.basename(local_path))

    click.echo(f"Copying {local_path} into container...")
    docker_exec_mkdir(container_temp_path)
    docker_cp_to_container(local_path, container_upload_path)

    try:
        click.echo("Uploading to MinIO...")
        mc_cmd("cp", "-r", container_upload_path, f"local/{bucket}/{prefix}")
        click.echo("✅ Upload complete")
    finally:
        click.echo("Cleaning up temporary files...")
        docker_exec_rm(container_temp_path)


@cli.command()
@click.option("--bucket", required=True)
@click.option("--object", "object_path", required=True, help="Object path inside bucket to overwrite")
@click.option("--local-file", required=True, type=click.Path(exists=True))
def overwrite(bucket, object_path, local_file):
    """Overwrite a single object with a local file."""
    temp_id = uuid.uuid4().hex
    container_temp_dir = f"/tmp/overwrite_{temp_id}"
    container_temp_file = os.path.join(container_temp_dir, os.path.basename(local_file))

    click.echo(f"Copying {local_file} into container...")
    docker_exec_mkdir(container_temp_dir)
    docker_cp_to_container(local_file, container_temp_file)

    try:
        click.echo("Overwriting object in MinIO...")
        mc_cmd("cp", container_temp_file, f"local/{bucket}/{object_path}")
        click.echo("✅ Overwrite complete")
    finally:
        click.echo("Cleaning up temporary files...")
        docker_exec_rm(container_temp_dir)


@cli.command()
@click.option("--bucket", required=True)
@click.option("--object", "object_path", required=True)
def delete(bucket, object_path):
    """Delete an object from the bucket."""
    click.echo(f"Deleting object: {bucket}/{object_path}...")
    mc_cmd("rm", f"local/{bucket}/{object_path}")
    click.echo("✅ Delete complete")


if __name__ == "__main__":
    cli()
