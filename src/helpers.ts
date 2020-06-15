import { RootConnection } from "chrome-debugging-client";
import Protocol from "devtools-protocol";
import {hasOwnProperty, Json, MapLike, JsonObject} from "./util";
import {ClassInstance, Value} from "./data";

type RemoteObject = Protocol.Runtime.RemoteObject;

function isInteger(text: string): boolean {
  const num = Number(text);
  return !isNaN(num) && Number.isInteger(num)
}

function isPrimitive(value: any): boolean {
  return (typeof(value) !== 'function' && typeof(value) !== 'object') || value === null;
}

export function raiseRemoteEvalError(exceptionDetails: Protocol.Runtime.ExceptionDetails) {
  const error = new Error(exceptionDetails.text);
  //error.stack = exceptionDetails.stackTrace;
  throw error;
}

export async function resolvePropertyPath(
  client: RootConnection,
  remoteObj: RemoteObject,
  propertyPath: (string | number)[]
): Promise<RemoteObject | null> {
  let resultObj = remoteObj;
  for (const propertyKey of propertyPath) {
    const resolvedObj = await resolveProperty(client, resultObj, propertyKey);
    if (resolvedObj === null) {
      return null;
    }
    resultObj = resolvedObj;
  }
  return resultObj;
}

export async function accessProperty(
  client: RootConnection,
  propDesc: Protocol.Runtime.PropertyDescriptor,
  objectGroup?: string,
) {

  // Plain values always have precedence, so if one is present we should immediately 
  // return the object the value refers to.
  if (propDesc.value !== undefined) {
    return propDesc.value;
  }

  // If there's no value, there still might be a getter. We will call it manually
  // and return the result if successfull.
  if (propDesc.get !== undefined) {
    const { result, exceptionDetails } = await client.send('Runtime.callFunctionOn', {
      functionDeclaration: propDesc.get,
      objectId: propDesc.get.objectId,
      objectGroup,
    });
    if (exceptionDetails !== undefined) {
      raiseRemoteEvalError(exceptionDetails);
    }
    return result;
  }

  // In JavaScript, getting a property without a value and without a getter results
  // in the value `undefined`.
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: 'undefined',
    objectGroup,
    silent: true
  });
  if (exceptionDetails !== undefined) {
    raiseRemoteEvalError(exceptionDetails);
  }
  return result;

}


export async function resolveProperty(
  client: RootConnection,
  remoteObj: RemoteObject,
  propertyKey: string | number | RemoteObject,
  objectGroup?: string,
): Promise<RemoteObject | null> {

  // Unfortunately, the Chrome DevTools protocol has no built-in way to access the property of a variable,
  // This means we have to emulate the algorithm that JavaScript uses by enumerating each property of the
  // target object.
  const { result, exceptionDetails } = await client.send('Runtime.getProperties', {
    objectId: remoteObj.objectId,
    objectGroup,
  });

  if (exceptionDetails !== undefined) {
    raiseRemoteEvalError(exceptionDetails);
  }

  // We no choice but to go through each property in the object.
  for (const propDesc of result) {
    if (isPrimitive(propertyKey)) {
      if (propDesc.name === propertyKey) {
        return accessProperty(client, propDesc);
      }
    } else {
      if (propDesc.symbol !== undefined && propDesc.symbol === propertyKey) {
        return accessProperty(client, propDesc);
      }
    }
  }

  // If we got here, we did not find the requested property.
  return null;
}

export async function findVariableInScopeChain(
  client: RootConnection,
  scopeChain: Protocol.Debugger.Scope[],
  varName: string
): Promise<RemoteObject | null> {
  for (const scope of scopeChain) {
    if (scope.object.value !== undefined && hasOwnProperty(scope.object.value, varName)) {
      return scope.object.value[varName];
    }
    const { result, exceptionDetails } = await client.send('Runtime.getProperties', { objectId: scope.object.objectId });
    if (exceptionDetails !== undefined) {
      raiseRemoteEvalError(exceptionDetails);
    }
    for (const remoteObj of result) {
      if (remoteObj.name === varName) {
        return remoteObj.value;
      }
    }
  }
  return null;
}

export async function* getAllVariablesInScopeChain(
  client: RootConnection,
  scopeChain: Protocol.Debugger.Scope[]
): AsyncIterableIterator<string> {
  for (const scope of scopeChain) {
    const { result, exceptionDetails } = await client.send('Runtime.getProperties', { objectId: scope.object.objectId });
    if (exceptionDetails !== undefined) {
      raiseRemoteEvalError(exceptionDetails);
    }
    yield* result;
  }
}

export interface RemoteObjectQueryOptions {
  /**
   * A filter that will be applied to any object that was found in the local/global scope.
   */
  filter?: (obj: RemoteObject) => boolean;
  /**
   * Additional instances of the given class that should always be included in the query result.
   */
  include?: string[];
}

export async function findAllObjectsMatching(
  client: RootConnection,
  callFrame: Protocol.Debugger.CallFrame,
  query: RemoteObjectQueryOptions
): Promise<Protocol.Runtime.RemoteObject[]> {

  const include = query.include ?? [];

  // This variable will hold all objects that the user cares about, including dependencies.
  const results: RemoteObject[] = [];

  for (const classPath of include) {

    const propertyPathElements = classPath.split('.');

    // We search for the class name defined by the '--include'-flag in this scope and any parent scope.
    const remoteObj = await findVariableInScopeChain(client, callFrame.scopeChain, propertyPathElements[0]);

    // We don't want a hard error. Instead, log the error and simply try the next path.
    if (remoteObj === null) {
      console.error(`A variable named ${propertyPathElements[0]} was not found in the scope surrounding the breakpoint.`);
      continue;
    }

    // Now resolve any property keys that were appended to the '--include'-flag.
    const matchingObj = await resolvePropertyPath(client, remoteObj, propertyPathElements.slice(1));

    // Again, no hard errors.
    if (matchingObj === null) {
      console.error(`The property ${propertyPathElements.slice(1).join('.')} was not found on ${propertyPathElements[0]}.`);
      continue;
    }

    // We don't need the class itself. We need the prototype.
    const protoObj = await resolveProperty(client, matchingObj, 'prototype');

    if (protoObj === null) {
      console.error(`${classPath} did not have a prototype that could be extracted.`);
      continue;
    }

    // This is where the magic happens. `Runtime.queryObjects` will search for all instances of the given prototype.
    // We save these instances to disk later on, but for now we keep them in memory.
    const { objects } = await client.send('Runtime.queryObjects', { prototypeObjectId: protoObj.objectId, objectGroup: 'snapshot' });

    // Push everything in our big array.
    await forEachElement(client, objects, obj => {
      results.push(obj);
    });

  }

  return results;

}

export async function forEachElement(
  client: RootConnection,
  arrayObj: RemoteObject,
  fn: (obj: RemoteObject) => void
): Promise<void> {
  const { result, exceptionDetails } = await client.send('Runtime.getProperties', { objectId: arrayObj.objectId })
  if (exceptionDetails !== undefined) {
    raiseRemoteEvalError(exceptionDetails);
  }
  for (const propDesc of result) {
    if (isInteger(propDesc.name)) {
      fn(propDesc.value!);
    }
  }
}

interface EvaluationResult {
  result: RemoteObject;
  exceptionDetails?: Protocol.Runtime.ExceptionDetails;
}

function unwrapEvaluationResult(evaluationResult: EvaluationResult) {
  if (evaluationResult.exceptionDetails !== undefined) {
    raiseRemoteEvalError(evaluationResult.exceptionDetails);
  }
  return evaluationResult.result;
}

export async function getObjectByExpression(
  client: RootConnection,
  expression: string,
  objectGroup?: string
): Promise<RemoteObject> {
  return unwrapEvaluationResult(
    await client.send('Runtime.evaluate', {
      expression,
      objectGroup,
      silent: true,
    })
  );
}

//export async function serializeObject(
//  client: RootConnection,
//  obj: RemoteObject
//): Promise<Json | null> {

//  const serializeSymbolObj = await getObjectByExpression(
//    client,
//    `Symbol.for('serialization tag')`,
//    `serialize-${obj.objectId}`
//  );

//  const serializeMethod = await resolveProperty(client, obj, serializeSymbolObj);
//  if (serializeMethod === null) {
//    return null;
//  }

//  const serialized = unwrapEvaluationResult(
//    await client.send('Runtime.callFunctionOn', {
//      functionDeclaration: serializeMethod.description,
//      objectId: obj.objectId,
//      silent: true,
//      returnByValue: true,
//    })
//  );

//  return serialized.value;
//}

export async function serializeObject(
  client: RootConnection,
  obj: RemoteObject,
) {

  const serialized = await visit(obj);
  await client.send('Runtime.releaseObjectGroup', { objectGroup: `serialize-${obj.objectId}` });
  return serialized;

  async function visit(obj: RemoteObject): Promise<Value> {

    switch (obj.type) {

      case 'boolean':
      case 'string':
      case 'number':
      {
        return obj.value;
      }

      case 'object':
      {
        const { result, exceptionDetails } = await client.send('Runtime.getProperties', {
          ownProperties: true,
          objectId: obj.objectId,
          objectGroup: `serialize-${obj.objectId}`
        })
        if (exceptionDetails !== undefined) {
          raiseRemoteEvalError(exceptionDetails);
        }

        const propsObj = {} as MapLike<Value>;

        for await (const prop of result) {

          // We don't support symbols as property keys for now.
          if (prop.symbol !== undefined) {
            continue;
          }

          // Getters are only derived from other properties, so it does not make sense to serialize them.
          // We should focus on those properties that have a dedicated value.
          if (prop.value !== undefined) {
            if (prop.name === '__proto__') {
              continue;
            }
            const valueObj = await accessProperty(client, prop);
            if (valueObj.type === 'function') {
              continue;
            }
            propsObj[prop.name] = await visit(valueObj);
          }

        }

        return new ClassInstance(obj.className!, propsObj);
      }

      default:
        throw new Error(`I did not know how to process a remote object of type ${obj.type}`);

    }

  }

}
