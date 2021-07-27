import click


@click.group()
@click.version_option(package_name='dive_server')
def cli():
    pass
