import { compile, CompileError } from './compiler.js';
import { PRESETS } from './presets.js';
import { ShaderRenderer } from './gpu.js';

const $ = id => document.getElementById(id);
const editor = $('source');
const canvas = $('canvas');
let renderer = null, compiled = null, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let seconds = 0, previousFrame = null, compileTimer, lastInfoUpdate = 0;
const timeline = $('time');

function graphicsMessage(message) {
  $('gpu-message').textContent = message;
  $('gpu-message').hidden = false;
  $('gpu-label').textContent = 'COMPILER ONLY';
}
function initializeRenderer() {
  try {
    renderer = new ShaderRenderer(canvas);
    $('gpu-message').hidden = true;
    $('gpu-label').textContent = 'WEBGL 2';
    if (compiled) { renderer.setProgram(compiled.vertex, compiled.fragment); renderer.render(seconds); }
  } catch (error) { renderer = null; graphicsMessage(error.message); }
}
initializeRenderer();
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); renderer = null;
  graphicsMessage('The graphics context was lost. The browser will try to restore it; your source and compiler output are preserved.');
});
canvas.addEventListener('webglcontextrestored', initializeRenderer);

for (const [index, preset] of PRESETS.entries()) {
  const option = document.createElement('option');
  option.value = index; option.textContent = preset.name;
  $('preset').append(option);
}
function lines() {
  $('line-numbers').textContent = editor.value.split('\n').map((_, index) => index + 1).join('\n');
  $('line-numbers').scrollTop = editor.scrollTop;
}
editor.addEventListener('scroll', () => { $('line-numbers').scrollTop = editor.scrollTop; });
function formatTree(ast) {
  const rows = ['Program'];
  function visit(node, indent) {
    const type = node.type ? ` : ${node.type}` : '';
    const detail = node.name ?? node.operator ?? node.fields ?? (node.kind === 'Literal' ? String(node.value) : '');
    rows.push(`${'  '.repeat(indent)}${node.kind}${detail ? ' ' + detail : ''}${type}  [${node.loc.line}:${node.loc.column}]`);
    const children = node.kind === 'Conditional' ? [node.condition, node.consequent, node.alternate] : node.arguments || [node.value, node.argument, node.left, node.right].filter(value => value && typeof value === 'object');
    for (const child of children) visit(child, indent + 1);
  }
  for (const binding of ast.bindings) visit(binding, 1);
  visit(ast.output, 1);
  return rows.join('\n');
}
function status(message, error = false) {
  $('status').classList.toggle('error', error);
  $('status').textContent = message;
}
function renderOnce() { if (renderer) renderer.render(seconds); }
function runCompile() {
  clearTimeout(compileTimer);
  try {
    const start = performance.now();
    const result = compile(editor.value);
    const elapsed = performance.now() - start;
    compiled = result;
    $('glsl').textContent = result.fragment;
    $('ast').textContent = formatTree(result.ast);
    $('copy').disabled = false;
    $('metrics').replaceChildren();
    for (const [value, label] of [[result.stats.tokens, 'tokens'], [result.stats.bindings, 'bindings'], [result.stats.expressions, 'typed expressions'], [result.stats.shaderBytes, 'shader bytes'], [elapsed.toFixed(2) + ' ms', 'compiler time']]) {
      const metric = document.createElement('span'), strong = document.createElement('strong');
      strong.textContent = value; metric.append(strong, document.createTextNode(label)); $('metrics').append(metric);
    }
    if (renderer) {
      try {
        renderer.setProgram(result.vertex, result.fragment); renderOnce();
        status(`✓ Compiled successfully · ${result.ast.output.type === 'vec3' ? 'RGB' : 'RGBA'} output · all types checked`);
      } catch (error) {
        status(`GPU rejected this shader: ${error.message}. The last successful render is preserved.`, true);
      }
    } else status('✓ Compiled successfully · GPU unavailable; inspect the generated shader below');
  } catch (error) {
    if (error instanceof CompileError) {
      status(`${error.phase.toUpperCase()} ERROR · line ${error.line}, column ${error.column}: ${error.message} Last valid render preserved. `, true);
      const jump = document.createElement('button'); jump.textContent = 'Go to error';
      jump.addEventListener('click', () => { editor.focus(); editor.setSelectionRange(error.start, Math.max(error.start + 1, error.end)); });
      $('status').append(jump);
    } else status(`Compiler error: ${error.message}`, true);
    // A failed edit does not replace the last well-typed program or its render.
  }
}
function loadPreset() {
  const preset = PRESETS[Number($('preset').value)];
  editor.value = preset.source;
  editor.scrollTop = 0; editor.scrollLeft = 0;
  $('preset-note').textContent = preset.note;
  lines(); seconds = 0; syncTime(); runCompile();
}
$('preset').addEventListener('change', loadPreset);
$('reset-source').addEventListener('click', loadPreset);
$('compile').addEventListener('click', runCompile);
editor.addEventListener('input', () => {
  lines(); clearTimeout(compileTimer);
  status('Source changed · compiling after a short pause…');
  compileTimer = setTimeout(runCompile, 650);
});
editor.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runCompile(); }
  if (event.key === 'Tab') {
    event.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
  if (event.key === 'Escape') $('compile').focus();
});
function syncTime() { timeline.value = String(seconds); $('time-value').textContent = `${seconds.toFixed(2)}s`; }
function syncPlay() {
  $('play').textContent = playing ? 'Ⅱ' : '▶';
  const label = playing ? 'Pause animation' : 'Play animation';
  $('play').setAttribute('aria-label', label); $('play').title = label;
}
$('play').addEventListener('click', () => { playing = !playing; previousFrame = null; syncPlay(); });
$('reset-time').addEventListener('click', () => { seconds = 0; previousFrame = null; syncTime(); renderOnce(); });
timeline.addEventListener('input', () => { seconds = Number(timeline.value); playing = false; syncPlay(); syncTime(); renderOnce(); });
document.addEventListener('visibilitychange', () => { previousFrame = null; });
function frame(timestamp) {
  if (!document.hidden) {
    if (playing && previousFrame !== null) seconds = (seconds + Math.min((timestamp - previousFrame) / 1000, 0.1)) % 60;
    if (playing) renderOnce();
    if (timestamp - lastInfoUpdate > 100) {
      syncTime(); $('resolution').textContent = `${canvas.width} × ${canvas.height}`; lastInfoUpdate = timestamp;
    }
    previousFrame = timestamp;
  } else previousFrame = null;
  requestAnimationFrame(frame);
}
new ResizeObserver(renderOnce).observe(canvas);
syncPlay(); loadPreset(); requestAnimationFrame(frame);

function selectTab(view, focus = false) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const active = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $('inspect-' + tab.dataset.view).hidden = !active;
    if (active && focus) tab.focus();
  }
  $('copy').hidden = view !== 'glsl';
}
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.view));
  tab.addEventListener('keydown', event => {
    const views = ['glsl', 'ast', 'reference'], index = views.indexOf(tab.dataset.view);
    let next;
    if (event.key === 'ArrowRight') next = views[(index + 1) % views.length];
    if (event.key === 'ArrowLeft') next = views[(index + views.length - 1) % views.length];
    if (event.key === 'Home') next = views[0];
    if (event.key === 'End') next = views.at(-1);
    if (next) { event.preventDefault(); selectTab(next, true); }
  });
}
$('copy').addEventListener('click', async () => {
  if (!compiled) return;
  try { await navigator.clipboard.writeText(compiled.fragment); $('copy').textContent = 'Copied'; }
  catch { $('copy').textContent = 'Select shader to copy'; }
  setTimeout(() => { $('copy').textContent = 'Copy GLSL'; }, 2000);
});
window.addEventListener('pagehide', () => renderer?.dispose());

window.addEventListener('pageshow', event => {
  if (event.persisted) { previousFrame = null; initializeRenderer(); }
});
