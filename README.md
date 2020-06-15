
> A command-line tool for carefully analysing differences between
> modified versions of the same JavaScript program.

`selfies` is a testing tool that takes 'pictures' of your JavaScript programs
while they are running. When `selfies` is done taking pictures, it will compare
them and report back to you how these pictures differ. This is extremely
useful for programs of which the output must remain the same, but where the
internals may change frequently.

## FAQ

### When are two objects considered equal?

Two objects are equal if they have the same constructur name and have the same
non-method properties. This means that the following two classes will be
considered equal:

```ts
class Point {

  constructor(
    public x: number,
    public y: number,
  ) {

  }

}

class Point extends Array {

  get x() {
    return this[0];
  }

  get y() {
    return this[1];
  }

  constructor(x: number, y: number) {
    super([x, y]);
  }

}
```

### How does it work?

The tool uses the [Chrome DevTools protocol](https://chromedevtools.github.io/devtools-protocol/v8)
to communicate with a debugger instance that is spawned together with the
program you want to take snapshots of. The trick is (ab)using the protocol to
deliver us copies of all objects we care about, and filtering out the
JavaScript objects that are uninteresting. Given that all JavaScript properties
must eventually end in a primitive value, we are able to `JSON.stringify` the
entire tree.

### Where is selfies used?

Given that this tool is brand-new, there are not a lot of projects using
`selfies` (yet). If you are using it in your own project, be sure to let us
know!

 - [The Bolt compiler](https://github.com/boltlang/Bolt) makes use of `selfies`
   to check that error reporting remains consistent over different versions of
   the compiler.

## License

This code is generously licensed under the MIT license.

