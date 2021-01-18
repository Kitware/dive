#!/bin/bash
set -e # exit immediately on fail

# This script is intended as an optional local utility.
# CI runs are expensive, so you can use this to run all
# CI Checks locally in parallel to verify that a commit will pass
# in much less time than CI would take.

yarn install --frozen-lockfile

yarn test

yarn lint &
yarn lint:templates

yarn build:web &
yarn build:lib &
yarn build:cli &

time wait 
