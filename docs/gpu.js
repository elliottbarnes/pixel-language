/** WebGL2 adapter: generated code only, transactional program replacement. */
export class ShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!this.gl) throw new Error('WebGL2 is unavailable. The compiler and inspectors still work; try a browser with hardware graphics enabled.');
    this.program = null;
    this.uniforms = {};
    this.vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.vao);
  }
  setProgram(vertexSource, fragmentSource) {
    const gl = this.gl;
    const shaders = [];
    let next;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('The graphics driver could not allocate a shader.');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Graphics driver rejected the generated shader.');
      }
      next = gl.createProgram();
      if (!next) throw new Error('The graphics driver could not allocate a program.');
      for (const shader of shaders) gl.attachShader(next, shader);
      gl.linkProgram(next);
      if (!gl.getProgramParameter(next, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(next) || 'Graphics driver could not link the program.');
      const previous = this.program;
      this.program = next;
      this.uniforms = { time: gl.getUniformLocation(next, '_time'), resolution: gl.getUniformLocation(next, '_resolution') };
      if (previous) gl.deleteProgram(previous);
    } catch (error) {
      if (next) gl.deleteProgram(next);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  render(time) {
    if (!this.program || this.gl.isContextLost()) return;
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2, 960 / Math.max(rect.width, rect.height, 1));
    const width = Math.max(1, Math.round(rect.width * scale)), height = Math.max(1, Math.round(rect.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uniforms.time, time);
    gl.uniform2f(this.uniforms.resolution, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose() {
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.program = null;
  }
}
