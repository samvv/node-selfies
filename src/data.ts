import { MapLike } from "./util";

export class ClassInstance {

  constructor(
    public name: string,
    public properties: MapLike<Value>,
  ) {

  }

}

export type PrimitiveValue
  = undefined
  | null
  | boolean
  | number
  | string

export type Value
  = PrimitiveValue
  | ClassInstance

