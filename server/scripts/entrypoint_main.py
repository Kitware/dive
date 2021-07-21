import sys

from scripts import cli
import scripts.commands_main  # noqa: E402 F401

if __name__ == '__main__':
    cli(sys.argv[1:])
