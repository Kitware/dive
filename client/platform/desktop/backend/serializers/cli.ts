#!/usr/bin/env ts-node-script

// eslint-disable-next-line import/no-extraneous-dependencies
import yargs from 'yargs';
import { parseFile } from './viame';

/**
 * Command line entrypoints to run these serializers
 * directly from console
 */

const { argv } = yargs
  .command('viame [file]', 'Parse VIAME CSV', (y) => {
    y.positional('file', {
      description: 'The file to parse',
      type: 'string',
    });
  })
  .help();

if (argv._.includes('viame')) {
  console.log(argv);
  parseFile(argv.file as string);
}
