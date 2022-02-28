# DIVE Command Line Tools

!!! note

    This page is **not related** to the VIAME command line (i.e. `kwiver`, `viame_train_detector`)

Some of the DIVE data conversion features are exposed through `dive`.  

## Features

* Convert between [various supported formats](DataFormats.md)
* Verify the integrity of a DIVE Json annotation file.

## Installation

Follow the docs in the [Debug Utils and Command Line Tools](https://github.com/Kitware/dive/tree/main/server#debug-utils-and-command-line-tools) section of `server/README.md`.

``` bash
git clone https://github.com/Kitware/dive.git
cd dive/server
poetry install
```

## Usage

``` bash
~$ poetry run dive convert --help

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
