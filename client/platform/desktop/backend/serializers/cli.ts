#!/usr/bin/env node
/// <reference types="@types/geojson" />

/**
 * Command-line entrypoints into serializers and other tooling.
 * See README.md for usage
 */

import { Writable } from 'stream';
import { stdout } from 'process';
import yargs from 'yargs';

import { loadJsonTracks, loadJsonMetadata } from 'platform/desktop/backend/native/common';
import { parseFile, serialize } from './viame';

// https://stackoverflow.com/questions/21491567/how-to-implement-a-writable-stream
function echoStream() {
  return new Writable({
    write(chunk, encoding, next) {
      stdout.write(chunk.toString());
      next();
    },
  });
}

async function parseViameFile(file: string) {
  const tracks = await parseFile(file);
  stdout.write(JSON.stringify(tracks));
}

async function parseJsonFile(filepath: string, metapath: string) {
  await Promise.all([
    loadJsonTracks(filepath),
    loadJsonMetadata(metapath),
  ]).then(([input, meta]) => serialize(echoStream(), input, meta));
}

const { argv } = yargs
  .command('viame2json [file]', 'Convert VIAME CSV to JSON', (y) => {
    y.positional('file', {
      description: 'The file to parse',
      type: 'string',
    }).demandOption('file');
  })
  .command('json2viame [file] [meta]', 'Convert JSON to VIAME CSV', (y) => {
    y.positional('file', {
      description: 'The file to parse',
      type: 'string',
    }).demandOption('file');
    y.positional('meta', {
      description: 'The metadata to parse',
      type: 'string',
    }).demandOption('meta');
  })
  .help();

if (argv._.includes('viame2json')) {
  parseViameFile(argv.file as string);
}
if (argv._.includes('json2viame')) {
  parseJsonFile(argv.file as string, argv.meta as string);
}
