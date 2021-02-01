# Command Line Tools: divecli

> **NOTE** this is an experimental feature with an unstable API.

Some of the DIVE desktop features are also exposed through `divecli`.

## Features

* Convert VIAME CSV to DIVE Json (and vice versa)
* Show statistics about DIVE imported datasets
* Run pipelines and training on DIVE imported datasets

## Installation

Global:

`npm i -g vue-media-annotator`

## Usage

``` bash
~$ divecli --help

# divecli <command>

# Commands:
#   divecli viame2json [file]         Convert VIAME CSV to JSON
#   divecli json2viame [file] [meta]  Convert JSON to VIAME CSV
#   divecli list-config               List viame pipeline configuration
#   divecli run-pipeline              Run a pipeline
#   divecli run-training              Run training
#   divecli stats                     Show stats on existing data

# Options:
#   --version  Show version number                                       [boolean]
#   --help     Show help                                                 [boolean]
```

## Example: Run pipeline

Run a kwiver pipeline on existing VIAME DIVE data. You'll need to import the data into dive desktop first.

``` bash
~$ divecli run-pipeline --id <DATASET_ID> \
  --pipe tracker_default.pipe \
  --type tracker \
  --data-path ~/VIAME_DATA/
```
