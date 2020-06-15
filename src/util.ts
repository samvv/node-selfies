
import { Stats } from "fs"
import * as fs from "fs-extra"

export interface MapLike<T> { [key: string]: T }

export interface JsonObject { [key: string]: Json }
export interface JsonArray extends Array<Json> { }
export type Json = null | number | string | boolean | JsonArray | JsonObject;

export class FancyError extends Error {
  constructor(public message: string) {
    super(message);
  }
}

export function readdirSync(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

export async function statPath(filepath: string | Buffer): Promise<Stats | null> {
  try {
    return await fs.stat(filepath)
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }
    throw e;
  }
}

export function hasOwnProperty(obj: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, property);
}

