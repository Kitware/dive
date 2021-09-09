# Command Line Tools

> **NOTE** this is an experimental feature with an unstable API.

Some of the DIVE data conversion features are also exposed through `dive`.

## Features

* Convert between VIAME CSV, DIVE Json, kpf, and coco.
* Verify the integrity of a DIVE Json annotation file.

## Installation

``` bash
# Install the command line tools directly from source
pip3 install git+https://github.com/Kitware/dive.git@main#subdirectory=server
```

## Usage

``` bash
~$ dive convert --help

# Usage: dive convert [OPTIONS] COMMAND [ARGS]...

# Options:
#   --version  Show the version and exit.
#   --help     Show this message and exit.

# Commands:
#   coco2dive
#   dive2viame
#   kpf2dive
#   viame2dive
```
