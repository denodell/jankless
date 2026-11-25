#!/usr/bin/env node
import { main } from 'jankless/cli';
import { adapter } from './adapter.js';
import { PACKAGE_NAME } from './constants.js';

process.exitCode = await main(process.argv.slice(2), { command: PACKAGE_NAME, adapter });
