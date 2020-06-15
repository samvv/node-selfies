
import * as path from "path"
import {Value} from "./data";
import {RemoteObjectQueryOptions, findAllObjectsMatching, serializeObject} from "./helpers";
import findFreePorts from "find-free-ports";
import {spawnWithWebSocket} from "chrome-debugging-client";

export class Snapshot {

  constructor(
    public readonly id: string,
    public values: Value[]
  ) {

  }

}

interface EventEmitterLike {
  once(eventName: string, cb: (...args: any[]) => void): void;
}

function eventTriggered(emitter: EventEmitterLike, eventName: string): Promise<void> {
  return new Promise(accept => {
    emitter.once(eventName, () => { accept(); });
  });
}

interface TakeSnapshotOptions extends RemoteObjectQueryOptions {
  exePath: string;
  args?: string[];
  breakpoints: string[];
}

export async function runAndTakeSnapshots(options: TakeSnapshotOptions): Promise<Snapshot[]> {

  const exePath = options.exePath;
  const args = options.args ?? [];
  const breakpoints = options.breakpoints ?? [];

  const [ port ] = await findFreePorts();

  const proc = await spawnWithWebSocket(exePath, [`--inspect-brk=${port}`, ...args], 'inherit');

  const snapshots: Snapshot[] = [];

  // We didn't find a close() method in on `RootConnection` so we use a little force
  // to close off the connection.
  proc.connection.on('Runtime.executionContextDestroyed', () => {
    proc.kill();
  });

  proc.connection.on('Debugger.scriptParsed', scriptParsedInfo => {
    //verbose(`Loaded ${scriptParsedInfo.url}`);
  });

  proc.connection.on('Debugger.paused', async (pausedInfo) => {

    // If this was the special breakpoint that we requested to be issued after everything has loaded,
    // we know we're finished and we can safely ignore it.
    if (pausedInfo.reason === 'Break on start' as string) {
      await proc.connection.send('Debugger.resume');
      return;
    }

    const objects = await findAllObjectsMatching(
      proc.connection,
      pausedInfo.callFrames[0],
      options
    );
    const serializedObjects = await Promise.all(objects.map(obj =>
      serializeObject(proc.connection, obj)));

    snapshots.push(new Snapshot(`${pausedInfo.callFrames[0].url}:${pausedInfo.callFrames[0].location.lineNumber+1}`, serializedObjects));

    await proc.connection.send('Debugger.resume');

  });

  await proc.connection.send('Runtime.enable');
  await proc.connection.send('Runtime.runIfWaitingForDebugger');
  await proc.connection.send('Debugger.enable');

  // FIXME We should probably work with a job scheduler instead for the case
  //       where there are a lot of breakpoints.
  await Promise.all(breakpoints.map(breakpoint => {
    const [file, lineNumberStr] = breakpoint.split(':');
    proc.connection.send('Debugger.setBreakpointByUrl', {
      url: `file://${path.resolve(file)}`,
      lineNumber: Number(lineNumberStr)-1,
      columnNumber: 0,
    });
  }));

  await eventTriggered(proc, 'exit');

  return snapshots;
}
