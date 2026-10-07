# Pixel Language

A typed graphics language that emits inspectable GLSL. Write mathematical expressions, inspect the checked syntax tree and generated shader, and see the result rendered with WebGL2.

[Open the playground](https://elliottbarnes.github.io/pixel-language/) · [Reference guide](reference/guide.md) · [Compiler checks](https://github.com/elliottbarnes/pixel-language/actions/workflows/check.yml)

![Pixel Language playground showing editable source, live graphics, and generated GLSL](assets/preview.png)

## Engineering choices

- A lexer, precedence parser, type checker, and GLSL ES 3.00 generator are implemented in plain JavaScript, with no runtime dependencies or build step.
- Scalar/vector types, immutable bindings, and explicit overload rules keep translation small enough to inspect. Generated local names are separate from source identifiers.
- Shader replacement compiles and links a new program before replacing the old one; failed replacements clean up temporary handles and preserve the previous program.
- Located diagnostics, declaration source maps, and explicit source/tree limits make compiler behavior inspectable. [The reference guide](reference/guide.md#compiler-architecture-and-api) describes the API and each stage.

Start with [`docs/compiler.js`](docs/compiler.js), the [compiler tests](tests/compiler.test.js), and [`docs/gpu.js`](docs/gpu.js) for rendering and cleanup.

## Run and check

Use **Node.js 24+** for tests and **Python 3** for the preview server. Rendering needs a browser with WebGL2; the compiler also runs in Node without a GPU. No packages or account are required.

```sh
git clone https://github.com/elliottbarnes/pixel-language.git
cd pixel-language
npm test
for file in docs/*.js; do node --check "$file"; done
python3 -m http.server 8080 --bind 127.0.0.1 --directory docs
```

Open **http://localhost:8080**, choose a preset, and inspect **Generated GLSL** or the **Typed syntax tree**. Stop the server with **Ctrl+C**. Source edits stay in page memory and are lost on reload.

## Current limits

The language has no loops, recursion, textures, mutation, or arbitrary shader pass-through. JavaScript compilation and driver shader compilation run on the main thread; source and tree limits do not guarantee a maximum compilation or GPU execution time.

The 17 Node tests cover compiler behavior, diagnostics, limits, and generated-name separation. They do not compile shaders on a real GPU or verify browser lifecycle recovery. There is no CPU rendering oracle or guarantee of identical pixels across drivers. See [numerical limits](reference/guide.md#limits-and-numerical-behavior) and [verification coverage](reference/guide.md#tests-and-verification).

## Go deeper

- [Worked example: a pulsing gradient](reference/guide.md#worked-example-a-pulsing-gradient)
- [Language and grammar](reference/guide.md#language)
- [Rendering, errors, and browser lifecycle](reference/guide.md#rendering-errors-and-browser-lifecycle)
- [Troubleshooting](reference/guide.md#troubleshooting) and [contributing](reference/guide.md#extending-and-contributing)

MIT — see [LICENSE](LICENSE).
