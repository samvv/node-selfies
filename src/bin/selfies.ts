#!/usr/bin/env node

import yargs from "yargs"
import { runAndTakeSnapshots } from "../index"

function wrapper<T extends object>(fn: (args: T) => number | void | Promise<number> | Promise<void>) {
  return async function(args: T) {
    const exitCode = await fn(args) as number | undefined;
    process.exit(exitCode ?? 0);
  }
}

yargs

  .command(['$0', 'compare'], 'Take a snapshot of the given set of files',

    yargs => yargs
      .string('alias')
      .array('alias')
      .describe('alias', 'A human-friendly name for the newly created snapshot')
      .array('breakpoint')
      .string('breakpoint')
      .alias('B', 'breakpoint')
      .describe('breakpoint', 'A statement in the script to take a snapshot on')
      .array('include')
      .string('include')
      .describe('include', 'Include instances of the given class in the snapshots')
      .alias('I', 'include')

    , wrapper(async (args) => {

      const aliases = args.alias ?? [];
      const breakpoints = args.breakpoint ?? [];

      const snapshots = await runAndTakeSnapshots({
        exePath: process.argv0,
        args: args._,
        breakpoints,
        include: args.include ?? [],
      })

      for (const snapshot of snapshots) {
        for (const value of snapshot.values) {
          console.log(value);
        }
      }

      //for (const alias of aliases) {
      //  saveSnapshots(snapshots);
      //}

    }))

  .help()
  .version()
  .argv;

