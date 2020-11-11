#!/usr/bin/env node
/// <reference types="../../../node_modules/@types/geojson" />

/**
 * Command-line entrypoints into serializers and other tooling.
 * See README.md for usage
 */

import yargs from 'yargs';

import { parseFile } from './viame';

async function parseViameFile(file: string) {
  const tracks = await parseFile(file);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(tracks));
}

const { argv } = yargs
  .command('viame [file]', 'Parse VIAME CSV', (y) => {
    y.positional('file', {
      description: 'The file to parse',
      type: 'string',
    });
  })
  .help();

if (argv._.includes('viame')) {
  parseViameFile(argv.file as string);
}
