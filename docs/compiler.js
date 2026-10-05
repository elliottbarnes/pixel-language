/** Pixel Language: lexer → parser → type checker → GLSL ES 3.00. */
export const LIMITS = Object.freeze({ source: 16000, tokens: 4096, bindings: 128, depth: 80 });
export const TYPES = ['float', 'bool', 'vec2', 'vec3', 'vec4'];
const INPUTS = { uv: 'vec2', time: 'float', resolution: 'vec2', pi: 'float' };
const GLSL_INPUTS = { uv: '_uv', time: '_time', resolution: '_resolution', pi: '3.141592653589793' };
const RESERVED = new Set(['let', 'output', 'true', 'false', ...TYPES, ...Object.keys(INPUTS)]);
const components = type => type === 'float' ? 1 : /^vec[234]$/.test(type) ? Number(type[3]) : 0;
const numeric = type => components(type) > 0;

export class CompileError extends Error {
  constructor(message, token = { line: 1, column: 1, start: 0, end: 1 }, phase = 'parse') {
    super(message);
    this.name = 'CompileError';
    Object.assign(this, { phase, line: token.line, column: token.column, start: token.start, end: token.end });
  }
}

export function tokenize(source) {
  if (typeof source !== 'string') throw new TypeError('Source must be a string.');
  if (source.length > LIMITS.source) throw new CompileError(`Source exceeds ${LIMITS.source} characters.`, undefined, 'lex');
  let index = 0, line = 1, column = 1;
  const tokens = [];
  const advance = () => { const ch = source[index++]; if (ch === '\n') { line++; column = 1; } else column++; return ch; };
  while (index < source.length) {
    if (/\s/.test(source[index])) { advance(); continue; }
    if (source.slice(index, index + 2) === '//') { while (index < source.length && source[index] !== '\n') advance(); continue; }
    const token = { start: index, line, column };
    const rest = source.slice(index);
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    const ident = rest.match(/^[A-Za-z_][A-Za-z_0-9]*/);
    let value, kind;
    if (number) { value = number[0]; kind = 'number'; }
    else if (ident) { value = ident[0]; kind = 'identifier'; }
    else if (['<=', '>=', '==', '!=', '&&', '||'].includes(rest.slice(0, 2))) { value = rest.slice(0, 2); kind = 'symbol'; }
    else if ('+-*/()=;,:?.<>!'.includes(rest[0])) { value = rest[0]; kind = 'symbol'; }
    else throw new CompileError(`Unexpected character ${JSON.stringify(rest[0])}.`, { ...token, end: index + 1 }, 'lex');
    for (let i = 0; i < value.length; i++) advance();
    token.end = index; token.value = value; token.kind = kind;
    if (kind === 'number' && (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > 3.402823466e38)) {
      throw new CompileError('Number is outside the finite float32 range.', token, 'lex');
    }
    tokens.push(token);
    if (tokens.length > LIMITS.tokens) throw new CompileError(`Program exceeds ${LIMITS.tokens} tokens.`, token, 'lex');
  }
  tokens.push({ kind: 'eof', value: '<end>', start: index, end: index, line, column });
  return tokens;
}

const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
export function parse(tokens) {
  let current = 0, depth = 0;
  const peek = () => tokens[current];
  const take = () => tokens[current++];
  const match = value => peek().value === value ? take() : null;
  const expect = value => {
    if (peek().value !== value) throw new CompileError(`Expected '${value}', found '${peek().value}'.`, peek());
    return take();
  };
  const node = (kind, token, fields) => ({ kind, loc: { line: token.line, column: token.column, start: token.start, end: token.end }, ...fields });
  function expression(min = 0) {
    depth++;
    if (depth > LIMITS.depth) throw new CompileError(`Expression nesting exceeds ${LIMITS.depth} levels.`, peek());
    const first = peek();
    let left;
    if (['-', '+', '!'].includes(first.value)) {
      take(); left = node('Unary', first, { operator: first.value, argument: expression(7) });
    } else if (match('(')) { left = expression(); expect(')'); }
    else if (first.kind === 'number') { take(); left = node('Literal', first, { value: Number(first.value), literalType: 'float' }); }
    else if (['true', 'false'].includes(first.value)) { take(); left = node('Literal', first, { value: first.value === 'true', literalType: 'bool' }); }
    else if (first.kind === 'identifier') {
      take();
      if (match('(')) {
        const args = [];
        if (peek().value !== ')') {
          do { args.push(expression()); } while (match(','));
        }
        expect(')'); left = node('Call', first, { name: first.value, arguments: args });
      } else left = node('Identifier', first, { name: first.value });
    } else throw new CompileError(`Expected an expression, found '${first.value}'.`, first);
    while (true) {
      if (peek().value === '.') {
        const dot = take(), field = take();
        if (field.kind !== 'identifier') throw new CompileError('Expected vector components after a dot.', field);
        left = node('Swizzle', dot, { argument: left, fields: field.value });
        continue;
      }
      const precedence = PRECEDENCE[peek().value];
      if (precedence === undefined || precedence < min) break;
      const op = take();
      left = node('Binary', op, { operator: op.value, left, right: expression(precedence + 1) });
    }
    if (min === 0 && match('?')) {
      const consequent = expression(); expect(':');
      left = node('Conditional', first, { condition: left, consequent, alternate: expression() });
    }
    depth--;
    return left;
  }
  const bindings = [];
  while (match('let')) {
    const name = take();
    if (name.kind !== 'identifier' || RESERVED.has(name.value)) throw new CompileError('Expected a non-reserved variable name after let.', name);
    let annotation = null;
    if (match(':')) {
      const type = take();
      if (!TYPES.includes(type.value)) throw new CompileError(`Unknown type '${type.value}'.`, type);
      annotation = type.value;
    }
    expect('=');
    bindings.push(node('Binding', name, { name: name.value, annotation, value: expression() }));
    expect(';');
    if (bindings.length > LIMITS.bindings) throw new CompileError(`Program exceeds ${LIMITS.bindings} bindings.`, name);
  }
  const outputToken = expect('output');
  const output = node('Output', outputToken, { value: expression() });
  expect(';');
  if (peek().kind !== 'eof') throw new CompileError('Only one output is allowed, at the end of the program.', peek());
  return { kind: 'Program', bindings, output };
}

const UNARY = new Set(['sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'fract', 'sqrt', 'exp', 'log', 'sign']);
const BINARY = new Set(['min', 'max', 'pow', 'mod', 'step', 'distance', 'dot']);
export const BUILTINS = Object.freeze([...UNARY, ...BINARY, 'length', 'normalize', 'clamp', 'mix', 'smoothstep', 'vec2', 'vec3', 'vec4']);

function callType(name, types, fail) {
  const arity = n => { if (types.length !== n) fail(`${name} expects ${n} argument${n === 1 ? '' : 's'}, got ${types.length}.`); };
  const requireNumeric = () => { if (!types.every(numeric)) fail(`${name} requires numeric arguments, got ${types.join(', ')}.`); };
  if (/^vec[234]$/.test(name)) {
    requireNumeric();
    const count = types.reduce((sum, type) => sum + components(type), 0);
    if (types.length === 1 && types[0] === 'float') return name;
    if (count !== components(name)) fail(`${name} needs one scalar to splat or exactly ${components(name)} components, got ${count}.`);
    return name;
  }
  if (UNARY.has(name)) { arity(1); requireNumeric(); return types[0]; }
  if (['length', 'normalize'].includes(name)) {
    arity(1);
    if (components(types[0]) < 2) fail(`${name} expects a vector.`);
    return name === 'length' ? 'float' : types[0];
  }
  if (BINARY.has(name)) {
    arity(2); requireNumeric();
    const [a, b] = types;
    if (['distance', 'dot'].includes(name)) {
      if (a !== b || components(a) < 2) fail(`${name} expects two vectors of the same size.`);
      return 'float';
    }
    if (name === 'step') {
      if (a !== b && a !== 'float') fail('step expects matching types, or a scalar edge and a vector value.');
      return b;
    }
    if (a !== b && (name === 'pow' || b !== 'float')) fail(`${name} expects matching types${name === 'pow' ? '' : ', or a vector followed by a scalar'}.`);
    return a;
  }
  if (['clamp', 'mix', 'smoothstep'].includes(name)) {
    arity(3); requireNumeric();
    const [a, b, c] = types;
    if (name === 'clamp') {
      if (!((a === b && b === c) || (b === 'float' && c === 'float'))) fail('clamp expects matching types, or a vector with two scalar bounds.');
      return a;
    }
    if (name === 'mix') {
      if (a !== b || (c !== a && c !== 'float')) fail('mix expects matching endpoints and a scalar or matching blend factor.');
      return a;
    }
    if (a !== b || (c !== a && a !== 'float')) fail('smoothstep expects matching types, or two scalar edges and a vector value.');
    return c;
  }
  fail(`Unknown function '${name}'.`);
}

export function typeCheck(ast) {
  const environment = new Map(Object.entries(INPUTS));
  let expressions = 0, treeDepth = 0;
  function infer(node) {
    expressions++;
    treeDepth++;
    if (treeDepth > LIMITS.depth) throw new CompileError(`Expression tree exceeds ${LIMITS.depth} levels.`, node.loc, 'type');
    const fail = message => { throw new CompileError(message, node.loc, 'type'); };
    let type;
    switch (node.kind) {
      case 'Literal': type = node.literalType; break;
      case 'Identifier':
        type = environment.get(node.name);
        if (!type) fail(`Unknown variable '${node.name}'. Declare it before use.`);
        break;
      case 'Unary': {
        const arg = infer(node.argument);
        if (node.operator === '!') { if (arg !== 'bool') fail(`! expects bool, got ${arg}.`); type = 'bool'; }
        else { if (!numeric(arg)) fail(`${node.operator} expects a numeric value, got ${arg}.`); type = arg; }
        break;
      }
      case 'Binary': {
        const a = infer(node.left), b = infer(node.right), op = node.operator;
        if (['&&', '||'].includes(op)) {
          if (a !== 'bool' || b !== 'bool') fail(`${op} expects two bool values.`);
          type = 'bool';
        } else if (['<', '<=', '>', '>='].includes(op)) {
          if (a !== 'float' || b !== 'float') fail(`${op} compares two scalars.`);
          type = 'bool';
        } else if (['==', '!='].includes(op)) {
          if (a !== b || !['float', 'bool'].includes(a)) fail(`${op} expects two scalars of the same type.`);
          type = 'bool';
        } else {
          if (!numeric(a) || !numeric(b) || (a !== b && a !== 'float' && b !== 'float')) fail(`Cannot apply ${op} to ${a} and ${b}.`);
          type = components(a) >= components(b) ? a : b;
        }
        break;
      }
      case 'Call': type = callType(node.name, node.arguments.map(infer), fail); break;
      case 'Swizzle': {
        const arg = infer(node.argument);
        if (components(arg) < 2) fail('Component selection requires a vector.');
        const family = ['xyzw', 'rgba'].find(chars => [...node.fields].every(ch => chars.includes(ch)));
        if (!family || node.fields.length < 1 || node.fields.length > 4) fail(`Invalid vector components '${node.fields}'. Use 1–4 xyzw or rgba components without mixing alphabets.`);
        if ([...node.fields].some(ch => family.indexOf(ch) >= components(arg))) fail(`Component '${node.fields}' is out of bounds for ${arg}.`);
        type = node.fields.length === 1 ? 'float' : `vec${node.fields.length}`;
        break;
      }
      case 'Conditional': {
        if (infer(node.condition) !== 'bool') fail('The condition before ? must be bool.');
        const a = infer(node.consequent), b = infer(node.alternate);
        if (a !== b) fail(`Conditional branches must have the same type, got ${a} and ${b}.`);
        type = a;
        break;
      }
      default: fail(`Unsupported node ${node.kind}.`);
    }
    node.type = type;
    treeDepth--;
    return type;
  }
  for (const binding of ast.bindings) {
    if (environment.has(binding.name) || BUILTINS.includes(binding.name)) throw new CompileError(`Cannot redefine '${binding.name}'.`, binding.loc, 'type');
    const type = infer(binding.value);
    if (binding.annotation && binding.annotation !== type) throw new CompileError(`'${binding.name}' is annotated ${binding.annotation}, but its value is ${type}.`, binding.loc, 'type');
    binding.type = type;
    environment.set(binding.name, type);
  }
  const outputType = infer(ast.output.value);
  if (!['vec3', 'vec4'].includes(outputType)) throw new CompileError(`Output must be vec3 (RGB) or vec4 (RGBA), got ${outputType}.`, ast.output.loc, 'type');
  ast.output.type = outputType;
  return { ast, expressions, symbols: Object.fromEntries(environment) };
}

export const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 _uv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  _uv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

export function generate(ast) {
  const names = new Map(Object.entries(GLSL_INPUTS));
  const floatLiteral = value => {
    const str = String(value);
    if (str.includes('e')) { const [base, exp] = str.split('e'); return `${base.includes('.') ? base : base + '.0'}e${exp}`; }
    return str.includes('.') ? str : `${str}.0`;
  };
  function emit(node) {
    switch (node.kind) {
      case 'Literal': return node.literalType === 'bool' ? String(node.value) : floatLiteral(node.value);
      case 'Identifier': return names.get(node.name);
      case 'Unary': return `(${node.operator}${emit(node.argument)})`;
      case 'Binary': return `(${emit(node.left)} ${node.operator} ${emit(node.right)})`;
      case 'Call': return `${node.name}(${node.arguments.map(emit).join(', ')})`;
      case 'Swizzle': return `(${emit(node.argument)}).${node.fields}`;
      case 'Conditional': return `(${emit(node.condition)} ? ${emit(node.consequent)} : ${emit(node.alternate)})`;
      default: throw new Error(`Cannot generate ${node.kind}.`);
    }
  }
  const lines = ['#version 300 es', 'precision highp float;', 'in vec2 _uv;', 'uniform float _time;', 'uniform vec2 _resolution;', 'out vec4 _color;', 'void main() {'];
  const sourceMap = [];
  ast.bindings.forEach((binding, i) => {
    const expression = emit(binding.value);
    names.set(binding.name, `_v${i}`);
    lines.push(`  ${binding.type} _v${i} = ${expression};`);
    sourceMap.push({ generatedLine: lines.length, sourceLine: binding.loc.line, name: binding.name });
  });
  const output = emit(ast.output.value);
  lines.push(`  _color = ${ast.output.type === 'vec3' ? `vec4(${output}, 1.0)` : output};`);
  sourceMap.push({ generatedLine: lines.length, sourceLine: ast.output.loc.line, name: 'output' });
  lines.push('}');
  return { fragment: lines.join('\n'), vertex: VERTEX_SHADER, sourceMap };
}

export function compile(source) {
  const tokens = tokenize(source);
  const checked = typeCheck(parse(tokens));
  const generated = generate(checked.ast);
  return { ...checked, ...generated, tokens, stats: { tokens: tokens.length - 1, bindings: checked.ast.bindings.length, expressions: checked.expressions, shaderBytes: new TextEncoder().encode(generated.fragment).length } };
}
