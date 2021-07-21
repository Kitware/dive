import sys

import click


@click.group()
@click.version_option()
def cli():
    pass


import scripts.commands  # noqa: E402 F401

if __name__ == '__main__':
    cli(sys.argv[1:])
