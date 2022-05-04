import click

from scripts import cli


@cli.command(name="migrate")
@click.option('--dry-run', is_flag=True)
@click.option('--limit', type=click.INT, default=0)
def migrate_server(dry_run, limit):
    """
    Migration script is idempotent.
    """
    pass


if __name__ == "__main__":
    migrate_server()
