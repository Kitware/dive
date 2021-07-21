import sys

from scripts.cli import cli
import scripts.commands_dev  # noqa: F401

if __name__ == '__main__':
    cli(sys.argv[1:])
