# Pixel Language

**A small typed language that turns mathematical expressions into live graphics.**

[Open the playground](https://elliottbarnes.github.io/pixel-language/) · [Source](https://github.com/elliottbarnes/pixel-language)

![Pixel Language playground showing editable source, live graphics, and generated GLSL](assets/preview.png)

Pixel Language implements a compiler front end in plain JavaScript: a located lexer, precedence parser, typed abstract syntax tree, semantic checker, and GLSL ES 3.00 code generator. Its WebGL2 adapter compiles that generated shader and draws a fullscreen triangle. The playground exposes both the typed tree and generated shader so the translation is inspectable.

The examples include animated interference, orbital distance fields, topographic contours, and repeating geometric cells. Edit any example to recompile it, pause animation, scrub time, and follow a type error to its source location.

No framework, runtime packages, build step, or external service is required. Source stays in your browser.

## Run locally

Use Node.js 24 or later for tests, and Python 3 for the static server:

```sh
npm test
npm run serve
```

Open **http://localhost:8080**. Serve the `docs` folder over HTTP; JavaScript modules will not work reliably by double-clicking `index.html`.

For GitHub Pages, publish the `docs` folder from the main branch. All asset references are relative, so the app works under a repository URL.

## Language

A program contains zero or more immutable `let` bindings, followed by exactly one `output` statement. Names must be declared before use. Shadowing, rebinding built-in inputs or functions, and implicit float/bool conversions are rejected.

```text
let p: vec2 = (uv - 0.5) * vec2(resolution.x / resolution.y, 1);
let radius = 0.25 + 0.04 * sin(time);
let d = abs(length(p) - radius);
let ring = 1 - smoothstep(0.005, 0.015, d);
output vec3(0.3, 0.9, 0.7) * ring;
```

### Types and inputs

| Name | Type | Meaning |
|---|---|---|
| `uv` | `vec2` | Fragment position in 0–1 coordinates; y increases upward |
| `time` | `float` | Animation seconds; playground timeline loops after 60 seconds |
| `resolution` | `vec2` | Actual render-target width and height in pixels |
| `pi` | `float` | π |

The five types are `float`, `bool`, `vec2`, `vec3`, and `vec4`. Numeric literals, including integers, have type `float`. Optional annotations check the inferred type; they do not cast it. The output must be `vec3` (RGB, with alpha 1 added by code generation) or `vec4` (RGBA). The playground canvas is opaque, so alpha is available in generated code but does not make the preview transparent.

### Expressions

From tightest to loosest binding:

1. Parentheses, calls, and vector component selection (`p.x`, `p.yx`, `color.rgb`).
2. Unary `+`, `-`, and `!`.
3. `*`, `/`.
4. `+`, `-`.
5. `<`, `<=`, `>`, `>=` on floats.
6. `==`, `!=` on matching float or bool scalars.
7. `&&` on booleans.
8. `||` on booleans.
9. `condition ? consequent : alternate`; the branches must have the same type.

Binary arithmetic is component-wise. Two vectors must have equal sizes; combining a float with a vector broadcasts the float to every component. Comparisons of vectors are intentionally unsupported. Swizzles use one to four `xyzw` or `rgba` components, may repeat components, and may not mix the two alphabets or read outside the vector size.

Constructors `vec2`, `vec3`, and `vec4` accept either one scalar to repeat, or a list of numeric arguments with exactly the required total component count. Unlike full GLSL, this language rejects truncating constructor arguments.

### Built-in functions

Here `T` means a float or vector type, and `V` means a vector type. Repeated type letters in a signature must match.

| Function | Accepted signatures | Return |
|---|---|---|
| `sin cos tan abs floor ceil fract sqrt exp log sign` | `(T)` | `T` |
| `min max mod` | `(T, T)` or `(V, float)` | first argument's type |
| `pow` | `(T, T)` | `T` |
| `step` | `(T, T)` or `(float, V)` | second argument's type |
| `clamp` | `(T, T, T)` or `(V, float, float)` | first argument's type |
| `mix` | `(T, T, T)` or `(V, V, float)` | first argument's type |
| `smoothstep` | `(T, T, T)` or `(float, float, V)` | third argument's type |
| `length` | `(V)` | `float` |
| `normalize` | `(V)` | `V` |
| `dot distance` | `(V, V)` | `float` |

### Grammar sketch

```ebnf
program     = { "let" identifier [ ":" type ] "=" expression ";" },
              "output" expression ";" ;
expression  = conditional ;
conditional = binary [ "?" expression ":" expression ] ;
primary     = number | "true" | "false" | identifier
            | identifier "(" [ expression { "," expression } ] ")"
            | "(" expression ")" ;
```

The parser implements the precedence table above for binary, unary, and postfix expressions. Identifiers use ASCII letters or underscores followed by letters, underscores, or digits. `//` comments continue to the end of a line. Semicolons are required.

## Compiler architecture

```text
Source
  → tokens with source offsets, line, column
  → precedence-parsed syntax tree
  → checked tree with a type on every expression
  → generated GLSL, renamed locals, declaration source map
  → browser shader compiler + linker
  → WebGL2 fullscreen triangle
```

Offsets count JavaScript UTF-16 code units, not UTF-8 bytes. Line and column numbers are 1-based. The generated declaration source map connects each local/output assignment to its source line; it is not a full expression-level GPU driver error map.

- `docs/compiler.js`: pure compiler, usable from Node or a browser.
- `docs/gpu.js`: shader allocation, compilation, linking, drawing, cleanup.
- `docs/presets.js`: real language examples; all compile in the test suite.
- `docs/app.js`: editor, diagnostics, inspectors, timeline, and interaction.
- `tests/compiler.test.js`: deterministic core tests using Node's built-in test runner.

Generated local names are `_v0`, `_v1`, and so on. A user's identifier cannot collide with shader infrastructure or inject arbitrary GLSL. The code generator only emits AST node forms already parsed and type checked. This version intentionally has no custom optimization passes; any GPU optimization belongs to the browser's shader compiler.

## Bounds and numerical behavior

The language has no loops, recursion, textures, arrays, mutation, or user-defined functions. Programs are limited to 16,000 source characters, 4,096 tokens, 128 bindings, and 80 levels of parse/tree nesting. Rendering is capped at 960 pixels on the longer axis with a maximum pixel ratio of 2. Bounded programs still have variable GPU cost; these limits reduce accidental runaway work but are not a timing guarantee.

Math uses GLSL floating-point behavior. Invalid domains (`sqrt(-1)`, `log(0)`), division by zero, normalization of a zero vector, and undefined `smoothstep` edge ordering are not statically rejected. They can yield implementation-dependent values or pixels. Numeric literals outside the finite float32 range are rejected; underflow follows GPU behavior. Colors are written directly to the default framebuffer and may clip outside its display range. No color-management or exact cross-driver pixel equivalence is claimed.

A failed source edit preserves the last valid shader and inspectors. A driver compilation failure keeps the previous render but shows the new generated code for diagnosis. WebGL2 context loss is reported and restoration recompiles the current valid source. If WebGL2 is unavailable, compilation and inspectors remain usable.

Animation pauses in hidden tabs and starts paused when the user prefers reduced motion. The editor's Tab key inserts spaces; Escape leaves the editor. Tabs support arrow-key navigation. Compile with Command/Ctrl + Enter or use the Compile button.

## Verification

`npm test` checks token locations, arithmetic precedence, immutable bindings, annotations, vector constructors, scalar/vector operations, swizzles, built-in overloads, conditions, generated locals, source maps, deterministic output, malformed source, and size limits.

These tests validate the compiler. They do not claim visual equivalence between GPU implementations. For browser verification, load every preset, inspect its compiled status, pause/scrub time, enter an intentional type error, restore the example, inspect the AST, and test with WebGL2 disabled.

## License

MIT — see [LICENSE](LICENSE).
