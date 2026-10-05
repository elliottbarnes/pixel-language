import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, tokenize, CompileError, LIMITS } from '../docs/compiler.js';
import { PRESETS } from '../docs/presets.js';

const output = expression => compile(`output ${expression};`);
function rejects(source, message, phase = 'type') {
  assert.throws(() => compile(source), error => error instanceof CompileError && error.phase === phase && message.test(error.message));
}

test('all bundled examples compile to typed GLSL with traceable declarations', () => {
  for (const preset of PRESETS) {
    const compiled = compile(preset.source);
    assert.equal(compiled.ast.output.type, 'vec3');
    assert.match(compiled.fragment, /^#version 300 es\n/);
    assert.equal(compiled.sourceMap.length, compiled.stats.bindings + 1);
    assert.equal(compiled.stats.shaderBytes, new TextEncoder().encode(compiled.fragment).length);
    assert.ok(compiled.stats.expressions > compiled.stats.bindings);
  }
});

test('lexer tracks exact line and column across comments and blank lines', () => {
  const tokens = tokenize('// hi\n\n  output vec3(.5, 1e-2, 2.);');
  assert.deepEqual({ value: tokens[0].value, line: tokens[0].line, column: tokens[0].column }, { value: 'output', line: 3, column: 3 });
  assert.deepEqual(tokens.filter(t => t.kind === 'number').map(t => Number(t.value)), [.5, .01, 2]);
});

test('arithmetic precedence and associativity are represented in the AST', () => {
  const ast = compile('let x = 9 - 3 - 2 * 2; output vec3(x);').ast.bindings[0].value;
  assert.equal(ast.operator, '-');
  assert.equal(ast.left.operator, '-');
  assert.equal(ast.right.operator, '*');
  assert.match(compile('output vec3(9 - 3 - 2 * 2);').fragment, /vec3\(\(\(9\.0 - 3\.0\) - \(2\.0 \* 2\.0\)\)\)/);
});

test('parentheses and unary operators bind correctly to swizzles', () => {
  const ast = compile('let x = -uv.x * (1 + 2); output vec3(x);').ast.bindings[0].value;
  assert.equal(ast.operator, '*');
  assert.equal(ast.left.kind, 'Unary');
  assert.equal(ast.left.argument.kind, 'Swizzle');
  assert.equal(ast.right.operator, '+');
});

test('annotations, scalar broadcasting, and RGB alpha generation', () => {
  const c = compile('let p: vec2 = 2 * uv + 1; output vec3(p, 0);');
  assert.equal(c.symbols.p, 'vec2');
  assert.match(c.fragment, /vec2 _v0 =/);
  assert.match(c.fragment, /_color = vec4\(vec3\(_v0, 0\.0\), 1\.0\);/);
  rejects('let p: float = uv; output vec3(1);', /annotated float.*vec2/);
});

test('RGBA output is emitted without an extra constructor', () => {
  assert.match(output('vec4(uv, 0, 1)').fragment, /_color = vec4\(_uv, 0\.0, 1\.0\);/);
});

test('booleans, comparisons, and nested conditional expressions are typed', () => {
  const c = compile('let test = uv.x < .5 && !(time > 1); output test ? vec3(1) : time > 5 ? vec3(0) : vec3(.5);');
  assert.equal(c.symbols.test, 'bool');
  assert.equal(c.ast.output.value.alternate.kind, 'Conditional');
  assert.equal(output('vec3(true == false ? 1 : 0)').ast.output.type, 'vec3');
  rejects('output time ? vec3(1) : vec3(0);', /condition.*bool/);
  rejects('output true ? vec3(1) : vec4(1);', /branches.*same type/);
  rejects('let b = uv < uv; output vec3(1);', /compares two scalars/);
  rejects('let b = uv == uv; output vec3(1);', /two scalars/);
});

test('constructors count components and reject invalid types', () => {
  assert.equal(output('vec4(vec2(1), vec2(2))').ast.output.type, 'vec4');
  assert.equal(output('vec3(uv, 1)').ast.output.type, 'vec3');
  rejects('output vec3();', /exactly 3 components/);
  rejects('output vec3(uv);', /got 2/);
  rejects('output vec3(true);', /numeric arguments/);
  rejects('output vec3(vec4(1));', /got 4/);
});

test('swizzles support repetitions and alternate alphabet but enforce bounds', () => {
  assert.equal(output('vec3(uv.yxy)').ast.output.type, 'vec3');
  assert.equal(output('vec4(1).rgb').ast.output.type, 'vec3');
  rejects('output uv.xyz;', /out of bounds/);
  rejects('output vec3(uv.xr, 1);', /without mixing alphabets/);
  rejects('output vec3(time.x);', /requires a vector/);
  rejects('output vec3(1).xxxxx;', /Invalid vector components/);
});

test('builtin overload rules match emitted GLSL signatures', () => {
  for (const expr of ['min(uv, 1)', 'max(uv, uv)', 'mod(uv, 1)', 'pow(uv, uv)', 'step(.5, uv)', 'clamp(uv, 0, 1)', 'mix(uv, uv, .5)', 'smoothstep(0, 1, uv)', 'sin(uv)', 'normalize(uv)']) {
    assert.equal(compile(`let x = ${expr}; output vec3(x, 1);`).symbols.x, 'vec2', expr);
  }
  for (const expr of ['dot(uv, uv)', 'length(uv)', 'distance(uv, uv)']) assert.equal(compile(`let x = ${expr}; output vec3(x);`).symbols.x, 'float');
  rejects('output vec3(min(1, uv), 1);', /matching types/);
  rejects('output vec3(pow(uv, 2), 1);', /matching types/);
  rejects('output vec3(step(uv, 1));', /scalar edge/);
  rejects('output vec3(smoothstep(uv, uv, 1));', /two scalar edges/);
  rejects('output vec3(dot(1, 1));', /two vectors/);
  rejects('output vec3(normalize(1));', /expects a vector/);
  rejects('output vec3(mix(uv, uv, vec3(1)), 1);', /matching endpoints/);
});

test('arity errors and unknown functions are precise', () => {
  rejects('output vec3(sin());', /expects 1 argument, got 0/);
  rejects('output vec3(clamp(1, 2));', /expects 3 arguments, got 2/);
  rejects('output vec3(frobnicate(1));', /Unknown function 'frobnicate'/);
});

test('names must be declared once before use; inputs and functions are protected', () => {
  rejects('let x = y; let y = 1; output vec3(x);', /Unknown variable 'y'/);
  rejects('let x = 1; let x = 2; output vec3(x);', /Cannot redefine 'x'/);
  rejects('let sin = 1; output vec3(sin);', /Cannot redefine 'sin'/);
  rejects('let uv = 1; output vec3(1);', /non-reserved variable name/, 'parse');
  rejects('let x = x; output vec3(x);', /Unknown variable 'x'/);
});

test('identifiers are renamed and cannot become GLSL source injection', () => {
  const c = compile('let gl_FragColor = 1; let _time = 2; output vec3(gl_FragColor + _time);');
  assert.equal(c.symbols.gl_FragColor, 'float');
  assert.doesNotMatch(c.fragment, /gl_FragColor/);
  assert.match(c.fragment, /_v0 \+ _v1/);
});

test('invalid programs fail with a located compiler diagnostic', () => {
  for (const source of ['', 'output;', 'output vec3(1)', 'output vec3(1); output vec3(0);', 'let a = 1 output vec3(a);', 'output vec3(1,);', 'output uv.;']) {
    assert.throws(() => compile(source), error => error instanceof CompileError && error.line >= 1 && error.column >= 1, source);
  }
  rejects('output 1;', /Output must be vec3.*vec4/);
  rejects('output vec3(uv + vec3(1));', /Cannot apply/);
  rejects('output vec3(1 % 2);', /Unexpected character/, 'lex');
  rejects('output vec3(1e40);', /float32 range/, 'lex');
  rejects('output vec3(NaN);', /Unknown variable/);
});

test('errors preserve source line and column', () => {
  try { compile('// title\nlet x = 1;\noutput vec3(nope);'); assert.fail('expected error'); }
  catch (error) { assert.equal(error.line, 3); assert.equal(error.column, 13); assert.equal(error.phase, 'type'); }
});

test('program size limits stop unbounded source and nested syntax', () => {
  rejects(' '.repeat(LIMITS.source + 1), /characters/, 'lex');
  rejects(`output vec3(${'('.repeat(LIMITS.depth + 1)}1${')'.repeat(LIMITS.depth + 1)});`, /nesting/, 'parse');
  const bindings = Array.from({ length: LIMITS.bindings + 1 }, (_, i) => `let a${i} = 1;`).join('\n');
  rejects(`${bindings}\noutput vec3(1);`, /bindings/, 'parse');
  rejects(`output vec3(${Array(2100).fill('1').join('+')});`, /tokens/, 'lex');
  rejects(`output vec3(${Array(100).fill('1').join('+')});`, /Expression tree/, 'type');
});

test('compilation is deterministic and source maps refer to actual generated lines', () => {
  const a = compile(PRESETS[0].source), b = compile(PRESETS[0].source);
  assert.deepEqual(a, b);
  for (const entry of a.sourceMap) assert.ok(a.fragment.split('\n')[entry.generatedLine - 1].includes('='));
});
