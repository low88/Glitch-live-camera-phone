/* Segnale Rotto — live glitch camera. WebGL pipeline:
   pass 1 (feedback): camera + previous output → datamosh / trails
   pass 2 (effects):  mirror → wave → slices → blocks → RGB split → colour → TV */
(() => {
'use strict';
const $ = id => document.getElementById(id);

/* ================= effect definitions ================= */
const MIRROR_MODES = ['Sx|Dx', 'Su|Giù', 'Quattro', 'Caleido'];
const pct = v => Math.round(v * 100);
const EFFECTS = [
  { id: 'tv', name: 'TV', c: '--amber', params: [
    ['scan', 'Righe', .55], ['noise', 'Neve', .35], ['track', 'Tracking', .35], ['bleed', 'Sbavo', .45]] },
  { id: 'rgb', name: 'RGB', c: '--r', params: [
    ['amt', 'Distanza', .35], ['angle', 'Angolo', 0, v => Math.round(v * 360) + '°'], ['wob', 'Tremolio', .3]] },
  { id: 'mosh', name: 'Mosh', c: '--g', params: [
    ['amt', 'Quantità', .85], ['drift', 'Deriva', .55], ['block', 'Blocco', .4], ['refresh', 'Ricarica', .15]] },
  { id: 'echo', name: 'Scia', c: '--b', params: [
    ['amt', 'Coda', .6], ['hue', 'Iride', .35]] },
  { id: 'slice', name: 'Fette', c: '--r', params: [
    ['dens', 'Quante', .4], ['shift', 'Spinta', .4], ['speed', 'Ritmo', .4]] },
  { id: 'block', name: 'Blocchi', c: '--g', params: [
    ['size', 'Pixel', .25], ['corrupt', 'Rottura', .35]] },
  { id: 'warp', name: 'Onda', c: '--b', params: [
    ['amp', 'Ampiezza', .3], ['freq', 'Frequenza', .35], ['speed', 'Velocità', .4]] },
  { id: 'mirror', name: 'Specchio', c: '--amber', params: [
    ['mode', 'Modo', .3, v => MIRROR_MODES[Math.min(3, v * 4 | 0)]], ['seg', 'Spicchi', .35, v => String(3 + Math.round(v * 9))], ['spin', 'Rotazione', .2]] },
  { id: 'color', name: 'Colore', c: '--r', params: [
    ['hue', 'Tinta', 0, v => Math.round(v * 360) + '°'], ['sat', 'Saturaz.', .5], ['post', 'Poster', 0], ['swap', 'Scambio', 0]] },
  { id: 'caos', name: 'Caos', c: '--fg', params: [
    ['depth', 'Profondità', .45], ['speed', 'Velocità', .4], ['jump', 'Salti', .25]] },
];
// params that should NOT be pushed by "Botta" or wobbled hard by Caos
const STEADY = new Set(['rgb.angle', 'mirror.mode', 'mirror.seg', 'color.hue', 'color.sat', 'caos.depth', 'caos.speed', 'caos.jump', 'mosh.block']);
const FX = Object.fromEntries(EFFECTS.map(e => [e.id, e]));

const PRESETS = [
  { name: 'Pulito', note: 'nessun effetto', on: [] },
  { name: 'VHS 1984', note: 'nastro consumato', on: ['tv', 'rgb', 'color'],
    v: { tv: { scan: .6, noise: .35, track: .5, bleed: .6 }, rgb: { amt: .18, angle: 0, wob: .25 }, color: { hue: .02, sat: .42, post: 0, swap: 0 } } },
  { name: 'Datamosh', note: 'le figure si fondono', on: ['mosh', 'rgb'],
    v: { mosh: { amt: .92, drift: .65, block: .45, refresh: .06 }, rgb: { amt: .12, angle: .1, wob: .2 } } },
  { name: 'Rotto digitale', note: 'file corrotto', on: ['slice', 'block', 'rgb', 'color'],
    v: { slice: { dens: .5, shift: .45, speed: .55 }, block: { size: .12, corrupt: .55 }, rgb: { amt: .45, angle: .25, wob: .6 }, color: { hue: 0, sat: .6, post: .25, swap: .3 } } },
  { name: 'Sogno', note: 'scie e colori liquidi', on: ['echo', 'warp', 'color'],
    v: { echo: { amt: .78, hue: .55 }, warp: { amp: .22, freq: .25, speed: .3 }, color: { hue: .15, sat: .75, post: 0, swap: 0 } } },
  { name: 'Caleido', note: 'specchi che girano', on: ['mirror', 'rgb', 'echo'],
    v: { mirror: { mode: .9, seg: .4, spin: .35 }, rgb: { amt: .3, angle: .5, wob: .4 }, echo: { amt: .45, hue: .4 } } },
  { name: 'Segnale perso', note: 'TV fuori sintonia', on: ['tv', 'slice', 'warp'],
    v: { tv: { scan: .7, noise: .8, track: .9, bleed: .7 }, slice: { dens: .3, shift: .7, speed: .8 }, warp: { amp: .12, freq: .8, speed: .9 } } },
  { name: 'Inferno', note: 'tutto acceso + caos', on: ['tv', 'rgb', 'mosh', 'slice', 'block', 'color', 'caos'],
    v: { caos: { depth: .7, speed: .6, jump: .5 } } },
];

/* ================= state ================= */
const defaults = () => ({
  on: { tv: true, rgb: true },
  v: Object.fromEntries(EFFECTS.map(e => [e.id, Object.fromEntries(e.params.map(p => [p[0], p[2]]))])),
  sel: 'tv', hd: true, mic: false,
});
let S = defaults();
try {
  const saved = JSON.parse(localStorage.getItem('sr-state') || 'null');
  if (saved && saved.v) { S = Object.assign(defaults(), saved); for (const e of EFFECTS) S.v[e.id] = Object.assign(defaults().v[e.id], saved.v[e.id] || {}); }
} catch (e) {}
let saveT = 0;
function persist() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem('sr-state', JSON.stringify(S)); } catch (e) {} }, 300); }

/* ================= WebGL ================= */
const canvas = $('gl');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false })
        || canvas.getContext('experimental-webgl');
if (!gl) { showNotice('Il tuo browser non supporta WebGL, che serve per gli effetti live.'); return; }

const VS = `attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec2 uRes; uniform float uTime;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec2 hash2(vec2 p){float n=hash(p);return vec2(n,hash(p+n+17.17));}
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
vec3 hueRot(vec3 c,float a){const vec3 k=vec3(.57735);float ca=cos(a);return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca);}
`;
const FS_FEEDBACK = COMMON + `
uniform sampler2D uCam,uPrev,uFb; uniform float uKey,uFlip;
uniform vec4 uMosh; uniform vec2 uEcho;
vec3 cam(sampler2D t,vec2 uv){if(uFlip>.5)uv.x=1.-uv.x;return texture2D(t,uv).rgb;}
void main(){
  vec2 uv=vUv; vec3 c=cam(uCam,uv);
  if(uKey>.5){gl_FragColor=vec4(c,1.);return;}
  vec3 res=c;
  if(uMosh.x>.001){
    float bs=floor(mix(4.,40.,uMosh.z));
    vec2 blk=floor(uv*uRes/bs), px=bs/uRes, bc=(blk+.5)*px;
    float lc=luma(cam(uCam,bc)), lp=luma(cam(uPrev,bc));
    vec2 g=vec2(luma(cam(uCam,bc+vec2(px.x,0.)))-luma(cam(uCam,bc-vec2(px.x,0.))),
                luma(cam(uCam,bc+vec2(0.,px.y)))-luma(cam(uCam,bc-vec2(0.,px.y))))*.5;
    float it=lc-lp;
    vec2 flow=clamp(-it*g/(dot(g,g)+.004),-2.,2.)*px;
    float m=abs(it)+abs(luma(cam(uCam,bc+px*.3))-luma(cam(uPrev,bc+px*.3)))+abs(luma(cam(uCam,bc-px*.3))-luma(cam(uPrev,bc-px*.3)));
    float moving=smoothstep(.02,.12,m/3.);
    vec2 jit=(hash2(blk+floor(uTime*3.))-.5)*px*2.;
    vec2 mv=(flow*3.+jit)*uMosh.y*2.5;
    vec3 dragged=texture2D(uFb,uv-mv).rgb, held=texture2D(uFb,uv).rgb;
    float refresh=mix(.012,.4,uMosh.w*uMosh.w);
    vec3 moshed=mix(mix(held,c,refresh),mix(dragged,c,refresh*.5),moving);
    res=mix(c,moshed,uMosh.x);
  }
  if(uEcho.x>.001){
    vec3 f=hueRot(texture2D(uFb,uv).rgb,uEcho.y*.7);
    res=max(res,f*mix(.55,.965,uEcho.x));
  }
  gl_FragColor=vec4(res,1.);
}`;
const FS_FX = COMMON + `
uniform sampler2D uSrc;
uniform vec4 uTV; uniform float uTVOn;
uniform vec3 uRGB, uSlice, uWarp, uMirror;
uniform vec2 uBlock; uniform float uMirrorOn;
uniform vec4 uColor; uniform float uColorOn;
void main(){
  vec2 uv=vUv; float t=uTime; float asp=uRes.x/uRes.y;
  if(uMirrorOn>.5){
    float md=floor(uMirror.x*3.999);
    if(md<.5) uv.x=uv.x<.5?uv.x:1.-uv.x;
    else if(md<1.5) uv.y=uv.y>.5?uv.y:1.-uv.y;
    else if(md<2.5){uv.x=uv.x<.5?uv.x:1.-uv.x;uv.y=uv.y>.5?uv.y:1.-uv.y;}
    else{
      vec2 c=uv-.5; c.x*=asp;
      float segs=floor(3.+uMirror.y*9.+.5), s=6.28318/segs;
      float a=atan(c.y,c.x)+t*(uMirror.z-.0)*.8, r=length(c);
      a=mod(a,s); a=abs(a-s*.5);
      uv=.5+r*vec2(cos(a)/asp,sin(a));
    }
  }
  if(uWarp.x>0.){
    float f=mix(2.,40.,uWarp.y), sp=uWarp.z*8.;
    uv.x+=sin(uv.y*f+t*sp)*uWarp.x*.06;
    uv.y+=sin(uv.x*f*.7+t*sp*1.3)*uWarp.x*.03;
  }
  float band=0.;
  if(uTVOn>.5&&uTV.z>0.){
    float bp=fract(t*.13); band=smoothstep(.07,0.,abs(uv.y-(1.-bp)))*uTV.z;
    float line=floor(vUv.y*uRes.y/2.);
    float j=(hash(vec2(line,floor(t*30.)))-.5)*.006*uTV.z+sin(vUv.y*30.+t*5.)*.002*uTV.z;
    j+=band*(hash(vec2(line,floor(t*60.)))-.3)*.07;
    if(hash(vec2(floor(t*7.),1.))<.18*uTV.z) j+=(hash(vec2(floor(vUv.y*8.),floor(t*7.)))-.5)*.08*uTV.z;
    uv.x+=j;
  }
  float swap=0.;
  if(uSlice.x>0.){
    float tk=floor(t*mix(.7,24.,uSlice.z));
    float rows=floor(mix(4.,50.,hash(vec2(tk,3.1))));
    float r=floor(uv.y*rows), h=hash(vec2(r,tk));
    if(h<uSlice.x*.7){uv.x+=(hash(vec2(r+11.,tk))-.5)*uSlice.y*.8; if(h<uSlice.x*.18) swap=1.;}
  }
  float bswap=0.;
  if(uBlock.x>0.){float bs=1.+floor(uBlock.x*uBlock.x*48.); uv=(floor(uv*uRes/bs)+.5)*bs/uRes;}
  if(uBlock.y>0.){
    vec2 b=floor(uv*uRes/24.); float tk=floor(t*12.);
    if(hash(b*.37+tk)<uBlock.y*.25){uv+=(hash2(b+tk)-.5)*.3*uBlock.y; bswap=1.;}
    if(hash(vec2(b.y,tk+5.))<uBlock.y*.06){uv.x=floor(uv.x*uRes.x/24.)*24./uRes.x; bswap=2.;}
  }
  uv=fract(uv);
  vec2 dir=vec2(cos(uRGB.y*6.28318),sin(uRGB.y*6.28318)*asp);
  float a=uRGB.x*.035*(1.+uRGB.z*(sin(t*9.)*.6+(hash(vec2(floor(t*15.),2.))-.5)*1.8));
  vec3 col;
  col.r=texture2D(uSrc,fract(uv+dir*a)).r;
  col.g=texture2D(uSrc,uv).g;
  col.b=texture2D(uSrc,fract(uv-dir*a)).b;
  if(uTVOn>.5&&uTV.w>0.){
    float o=uTV.w*.01, I=0., Q=0.;
    for(int k=0;k<5;k++){vec3 s=texture2D(uSrc,fract(uv-vec2(o*float(k),0.))).rgb;
      I+=dot(s,vec3(.596,-.274,-.322)); Q+=dot(s,vec3(.211,-.523,.312));}
    I/=5.; Q/=5.; float Y=luma(col);
    vec3 bl=vec3(Y+.956*I+.621*Q,Y-.272*I-.647*Q,Y-1.106*I+1.703*Q);
    col=mix(col,bl,min(1.,uTV.w*1.4));
  }
  if(swap>.5) col=col.brg;
  if(bswap>1.5) col=1.-col; else if(bswap>.5) col=col.gbr*1.15;
  if(uColorOn>.5){
    col=hueRot(col,uColor.x*6.28318);
    col=mix(vec3(luma(col)),col,uColor.y*2.);
    if(uColor.z>0.){float lv=floor(mix(14.,2.,uColor.z)); col=floor(col*lv+.5)/lv;}
    if(uColor.w>0.){vec3 s=mix(col,col.gbr,smoothstep(0.,.5,uColor.w)); col=mix(s,1.-s,smoothstep(.5,1.,uColor.w));}
  }
  if(uTVOn>.5){
    float sl=sin(gl_FragCoord.y*2.0944)*.5+.5;
    col*=1.-uTV.x*.5*(1.-sl);
    col+=(hash(vUv*uRes+fract(t*7.)*97.)-.5)*uTV.y*.5;
    col+=band*.22;
    float ln=hash(vec2(floor(vUv.y*uRes.y/3.),floor(t*20.)));
    if(ln>1.-uTV.y*.035) col=mix(col,vec3(hash(vUv*uRes+t)),.75);
    vec2 c=vUv-.5; col*=1.-dot(c,c)*uTV.x*1.1;
    col=mix(col,col*vec3(1.06,1.,.9),uTV.x*.5);
  }
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
let P1, P2;
try { P1 = program(FS_FEEDBACK); P2 = program(FS_FX); }
catch (e) { showNotice('Errore grafico: ' + e.message); console.error(e); return; }

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function makeTex(w, h) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}
const camTex = [makeTex(), makeTex()];
let ci = 0, fbTex = [], fbo = [], fi = 0, W = 0, H = 0, needKey = true;
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

function setSize(sw, sh) {
  const long = S.hd ? 1280 : 640, k = Math.min(1, long / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * k)), h = Math.max(2, Math.round(sh * k));
  if (w === W && h === H) return;
  W = w; H = h; canvas.width = W; canvas.height = H;
  fbTex.forEach(t => gl.deleteTexture(t)); fbo.forEach(f => gl.deleteFramebuffer(f));
  fbTex = [makeTex(W, H), makeTex(W, H)];
  fbo = fbTex.map(t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  needKey = true;
}

/* ================= sources ================= */
const video = document.createElement('video');
video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.autoplay = true;
const testCv = document.createElement('canvas'); testCv.width = 540; testCv.height = 720;
const tctx = testCv.getContext('2d');
let source = 'test', stream = null, facing = 'user', still = null, newFrame = true;

function drawTest(t) {
  const c = tctx, w = testCv.width, h = testCv.height;
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((col, i) => { c.fillStyle = col; c.fillRect(i * w / 7, 0, w / 7 + 1, h * .62); });
  c.fillStyle = '#121016'; c.fillRect(0, h * .62, w, h * .38);
  for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#eee' : '#111'; c.fillRect(i * w / 8, h * .62, w / 8 + 1, h * .06); }
  const x = w / 2 + Math.sin(t * 1.1) * w * .3, y = h * .38 + Math.cos(t * .8) * h * .16;
  c.fillStyle = '#ff3d6e'; c.beginPath(); c.arc(x, y, 70, 0, 7); c.fill();
  c.fillStyle = '#4fb6ff'; c.fillRect(w - x - 45, h * .55 - (y - h * .38) - 45, 90, 90);
  c.fillStyle = '#ffc23d'; c.font = 'bold 42px monospace'; c.textAlign = 'center';
  c.fillText('NESSUN SEGNALE', w / 2, h * .8);
  c.fillStyle = '#efe9dd'; c.font = '28px monospace';
  c.fillText(new Date().toLocaleTimeString('it-IT'), w / 2, h * .88);
}

function hookFrames() {
  if ('requestVideoFrameCallback' in video) {
    const cb = () => { newFrame = true; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
    hookFrames.rvfc = true;
  }
}
hookFrames();

async function startCamera() {
  hideNotice();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNotice('La camera live funziona solo da un indirizzo <b>https</b>. Apri l’app dal link pubblicato, non dal file.');
    return;
  }
  try {
    stopStream();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    video.srcObject = stream;
    if (video.src) { URL.revokeObjectURL(video.src); video.removeAttribute('src'); }
    video.loop = false;
    await video.play();
    source = 'cam'; needKey = true; requestWake();
  } catch (e) {
    console.warn(e);
    const msg = e && e.name === 'NotAllowedError'
      ? 'Accesso alla camera negato. Consentilo nelle impostazioni del browser per questo sito, poi tocca <b>Riprova</b>.'
      : 'Non trovo una camera disponibile. Puoi usare un video dalla galleria.';
    showNotice(msg + '<br><button class="pill" id="retryCam">Riprova</button>');
    $('retryCam').onclick = startCamera;
  }
}
function stopStream() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
function loadFile(f) {
  if (!f) return;
  stopStream(); needKey = true;
  if (f.type.startsWith('image/')) {
    const img = new Image(); img.onload = () => { still = img; source = 'image'; }; img.src = URL.createObjectURL(f); return;
  }
  video.srcObject = null; if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(f); video.loop = true;
  video.play().then(() => { source = 'file'; }).catch(() => showNotice('Non riesco a riprodurre questo video.'));
}

/* ================= modulation ================= */
let kickV = 0, caosFlip = new Set(), nextJump = 0;
const seeds = {}; EFFECTS.forEach((e, i) => e.params.forEach((p, j) => seeds[e.id + '.' + p[0]] = i * 7.31 + j * 3.17));
const wobble = (t, s) => Math.sin(t * 1.0 + s) * .5 + Math.sin(t * 1.73 + s * 2.1) * .3 + Math.sin(t * 3.11 + s * 3.7) * .2;
const isOn = id => !!S.on[id] !== caosFlip.has(id);

function effective(t) {
  const caos = S.on.caos, cv = S.v.caos;
  const ct = t * (.3 + cv.speed * 4);
  if (caos && t > nextJump) {
    nextJump = t + .5 + Math.random() * (4 - cv.speed * 3.2);
    caosFlip.clear();
    if (Math.random() < cv.jump) {
      const pool = EFFECTS.filter(e => e.id !== 'caos').map(e => e.id);
      const n = 1 + (Math.random() * (1 + cv.jump * 3) | 0);
      for (let i = 0; i < n; i++) caosFlip.add(pool[Math.random() * pool.length | 0]);
      if (caosFlip.has('mosh')) needKey = true;
    }
    renderChips();
  }
  if (!caos && caosFlip.size) { caosFlip.clear(); renderChips(); }
  const out = {};
  for (const e of EFFECTS) {
    const on = isOn(e.id), o = {};
    for (const [k] of e.params) {
      let v = S.v[e.id][k]; const key = e.id + '.' + k;
      if (caos && on && e.id !== 'caos') v += wobble(ct, seeds[key]) * cv.depth * (STEADY.has(key) ? .25 : .7);
      if (on && !STEADY.has(key)) v += kickV * .5;
      o[k] = Math.max(0, Math.min(1, v));
    }
    o.on = on; out[e.id] = o;
  }
  // "Botta" always hits, even with effects off
  if (kickV > .02) {
    if (!out.rgb.on) { out.rgb.on = true; out.rgb.amt = kickV * .6; out.rgb.angle = Math.random(); out.rgb.wob = 1; }
    if (!out.slice.on) { out.slice.on = true; out.slice.dens = kickV * .7; out.slice.shift = kickV * .6; out.slice.speed = 1; }
  }
  return out;
}

/* ================= render loop ================= */
let lastT = 0, fpsAcc = 0, fpsN = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  const t = ms / 1000;
  fpsAcc += t - lastT; fpsN++; lastT = t;
  if (fpsAcc > .5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }

  let src = null, sw = 0, sh = 0;
  if ((source === 'cam' || source === 'file') && video.readyState >= 2 && video.videoWidth) {
    src = video; sw = video.videoWidth; sh = video.videoHeight; if (!hookFrames.rvfc) newFrame = true;
  } else if (source === 'image' && still) { src = still; sw = still.naturalWidth; sh = still.naturalHeight; newFrame = true; }
  else { drawTest(t); src = testCv; sw = testCv.width; sh = testCv.height; newFrame = true; }
  setSize(sw, sh);

  const E = effective(t);
  kickV *= .9;

  if (newFrame) {
    ci ^= 1;
    gl.bindTexture(gl.TEXTURE_2D, camTex[ci]);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (e) { return; }
    // pass 1: feedback
    const out = fi ^ 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[out]); gl.viewport(0, 0, W, H);
    gl.useProgram(P1.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, camTex[ci]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, camTex[ci ^ 1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fbTex[fi]);
    gl.uniform1i(P1.u.uCam, 0); gl.uniform1i(P1.u.uPrev, 1); gl.uniform1i(P1.u.uFb, 2);
    gl.uniform2f(P1.u.uRes, W, H); gl.uniform1f(P1.u.uTime, t);
    gl.uniform1f(P1.u.uKey, needKey ? 1 : 0);
    gl.uniform1f(P1.u.uFlip, source === 'cam' && facing === 'user' ? 1 : 0);
    const m = E.mosh, ec = E.echo;
    gl.uniform4f(P1.u.uMosh, m.on ? m.amt : 0, m.drift, m.block, m.refresh);
    gl.uniform2f(P1.u.uEcho, ec.on ? ec.amt : 0, ec.hue);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    fi = out; needKey = false; newFrame = false;
  }
  // pass 2: effects to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
  gl.useProgram(P2.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTex[fi]);
  gl.uniform1i(P2.u.uSrc, 0);
  gl.uniform2f(P2.u.uRes, W, H); gl.uniform1f(P2.u.uTime, t);
  const tv = E.tv, rgb = E.rgb, sl = E.slice, bl = E.block, wp = E.warp, mi = E.mirror, co = E.color;
  gl.uniform1f(P2.u.uTVOn, tv.on ? 1 : 0); gl.uniform4f(P2.u.uTV, tv.scan, tv.noise, tv.track, tv.bleed);
  gl.uniform3f(P2.u.uRGB, rgb.on ? rgb.amt : 0, rgb.angle, rgb.wob);
  gl.uniform3f(P2.u.uSlice, sl.on ? sl.dens : 0, sl.shift, sl.speed);
  gl.uniform2f(P2.u.uBlock, bl.on ? bl.size : 0, bl.on ? bl.corrupt : 0);
  gl.uniform3f(P2.u.uWarp, wp.on ? wp.amp : 0, wp.freq, wp.speed);
  gl.uniform1f(P2.u.uMirrorOn, mi.on ? 1 : 0); gl.uniform3f(P2.u.uMirror, mi.mode, mi.seg, mi.spin);
  gl.uniform1f(P2.u.uColorOn, co.on ? 1 : 0); gl.uniform4f(P2.u.uColor, co.hue, co.sat, co.post, co.swap);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (recorder && recorder.state === 'recording') {
    const s = (performance.now() - recStart) / 1000 | 0;
    $('recTime').textContent = String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
}

/* ================= UI: chips, knobs ================= */
const chipsEl = $('chips'), knobsEl = $('knobs');
function renderChips() {
  chipsEl.innerHTML = '';
  for (const e of EFFECTS) {
    const b = document.createElement('button');
    b.className = 'chip' + (S.on[e.id] ? ' on' : '') + (caosFlip.has(e.id) ? ' flip' : '');
    b.style.setProperty('--c', `var(${e.c})`);
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', S.sel === e.id);
    b.innerHTML = `<span class="led"></span>${e.name}`;
    b.onclick = () => {
      if (S.sel === e.id) toggleFx(e.id); else { S.sel = e.id; persist(); renderChips(); renderCard(); }
    };
    chipsEl.appendChild(b);
  }
}
function toggleFx(id, val) {
  S.on[id] = val === undefined ? !S.on[id] : val;
  if (id === 'mosh' || id === 'echo') needKey = true;
  persist(); renderChips(); renderCard();
}
const ARC0 = 135, SWEEP = 270;
function arcPath(cx, cy, r, a0, a1) {
  const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function renderCard() {
  const e = FX[S.sel];
  $('card').style.setProperty('--c', `var(${e.c})`);
  $('cardTitle').innerHTML = `Effetto <b>${e.name}</b>`;
  const sw = $('fxSwitch'); sw.setAttribute('aria-checked', !!S.on[e.id]); sw.setAttribute('aria-label', 'Attiva ' + e.name);
  knobsEl.innerHTML = '';
  knobsEl.style.gridTemplateColumns = `repeat(${Math.max(3, e.params.length)},1fr)`;
  for (const [k, label, def, fmt] of e.params) knobsEl.appendChild(makeKnob(e, k, label, def, fmt || pct));
}
function makeKnob(e, k, label, def, fmt) {
  const wrap = document.createElement('div');
  wrap.className = 'knob' + (S.on[e.id] ? '' : ' dim');
  wrap.setAttribute('role', 'slider'); wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', label); wrap.setAttribute('aria-valuemin', 0); wrap.setAttribute('aria-valuemax', 100);
  wrap.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="22" fill="#26212f" stroke="#3a3345"/>
    <path class="trk" fill="none" stroke="#3a3345" stroke-width="4" stroke-linecap="round" d="${arcPath(32, 32, 28, ARC0, ARC0 + SWEEP)}"/>
    <path class="val" fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round"/>
    <line class="ptr" x1="32" y1="32" x2="32" y2="14" stroke="#efe9dd" stroke-width="3" stroke-linecap="round"/>
  </svg><span class="kl">${label}</span><span class="kv"></span>`;
  const valP = wrap.querySelector('.val'), ptr = wrap.querySelector('.ptr'), kv = wrap.querySelector('.kv');
  const draw = () => {
    const v = S.v[e.id][k], a = ARC0 + SWEEP * v;
    valP.setAttribute('d', v > .002 ? arcPath(32, 32, 28, ARC0, a) : '');
    ptr.setAttribute('transform', `rotate(${a + 90} 32 32)`);
    kv.textContent = fmt(v); wrap.setAttribute('aria-valuenow', pct(v)); wrap.setAttribute('aria-valuetext', fmt(v));
  };
  const set = v => {
    S.v[e.id][k] = Math.max(0, Math.min(1, v)); draw(); persist();
    if (!S.on[e.id]) { S.on[e.id] = true; if (e.id === 'mosh' || e.id === 'echo') needKey = true; renderChips(); wrap.parentNode && wrap.parentNode.querySelectorAll('.knob').forEach(n => n.classList.remove('dim')); $('fxSwitch').setAttribute('aria-checked', true); }
  };
  let sx = 0, sy = 0, sv = 0, lastTap = 0;
  wrap.addEventListener('pointerdown', ev => {
    ev.preventDefault(); wrap.setPointerCapture(ev.pointerId); wrap.classList.add('active');
    sx = ev.clientX; sy = ev.clientY; sv = S.v[e.id][k];
    const now = performance.now(); if (now - lastTap < 300) { set(def); lastTap = 0; } else lastTap = now;
  });
  wrap.addEventListener('pointermove', ev => {
    if (!wrap.hasPointerCapture(ev.pointerId)) return;
    const d = (sy - ev.clientY) / 170 + (ev.clientX - sx) / 220;
    if (Math.abs(d) > .004) set(sv + d);
  });
  const end = () => wrap.classList.remove('active');
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('keydown', ev => {
    const st = ev.shiftKey ? .1 : .02;
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') { set(S.v[e.id][k] + st); ev.preventDefault(); }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') { set(S.v[e.id][k] - st); ev.preventDefault(); }
  });
  draw();
  return wrap;
}
$('fxSwitch').onclick = () => toggleFx(S.sel);

/* ================= popovers ================= */
const pop = $('pop');
function openPop(html, top) {
  pop.innerHTML = html; pop.classList.toggle('top', !!top); pop.hidden = false;
}
function closePop() { pop.hidden = true; }
document.addEventListener('pointerdown', ev => {
  if (!pop.hidden && !pop.contains(ev.target) && !ev.target.closest('#presetBtn,#srcBtn')) closePop();
}, true);

$('presetBtn').onclick = () => {
  if (!pop.hidden) return closePop();
  openPop('<h4>Preset</h4>' + PRESETS.map((p, i) => `<button data-p="${i}">${p.name}<small>${p.note}</small></button>`).join(''));
  pop.querySelectorAll('button').forEach(b => b.onclick = () => applyPreset(PRESETS[+b.dataset.p]));
};
function applyPreset(p) {
  const d = defaults();
  S.on = Object.fromEntries(p.on.map(id => [id, true]));
  for (const e of EFFECTS) S.v[e.id] = Object.assign({}, d.v[e.id], (p.v || {})[e.id] || {});
  if (p.on.length) S.sel = p.on[0];
  needKey = true; caosFlip.clear(); persist(); renderChips(); renderCard(); closePop();
}
$('srcBtn').onclick = () => {
  if (!pop.hidden) return closePop();
  const cur = source;
  openPop(`<h4>Sorgente</h4>
    <button data-s="cam" class="${cur === 'cam' ? 'current' : ''}">Camera live<small>in tempo reale</small></button>
    <button data-s="file" class="${cur === 'file' || cur === 'image' ? 'current' : ''}">Dalla galleria<small>video o foto</small></button>
    <button data-s="test" class="${cur === 'test' ? 'current' : ''}">Monoscopio<small>segnale di prova</small></button>
    <button data-s="fit">${document.getElementById('app').classList.contains('contain') ? 'Riempi schermo' : 'Inquadratura intera'}<small>adatta l’immagine</small></button>`, true);
  pop.querySelectorAll('button').forEach(b => b.onclick = () => {
    const s = b.dataset.s; closePop();
    if (s === 'cam') startCamera();
    else if (s === 'file') $('fileIn').click();
    else if (s === 'fit') $('app').classList.toggle('contain');
    else { stopStream(); source = 'test'; needKey = true; }
  });
};
$('fileIn').onchange = ev => { loadFile(ev.target.files[0]); ev.target.value = ''; };

/* ================= top bar ================= */
$('flipBtn').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); };
function renderTop() {
  $('resBtn').textContent = S.hd ? 'HD' : 'SD';
  $('micBtn').setAttribute('aria-pressed', !!S.mic);
}
$('resBtn').onclick = () => { S.hd = !S.hd; W = 0; persist(); renderTop(); };
$('micBtn').onclick = () => { S.mic = !S.mic; persist(); renderTop(); };
$('hideUi').onclick = () => { $('app').classList.add('bare'); $('showUi').hidden = false; closePop(); };
$('showUi').onclick = () => { $('app').classList.remove('bare'); $('showUi').hidden = true; };

/* tap on the picture = Botta, double tap = clean frame */
let lastCanvasTap = 0;
canvas.addEventListener('pointerdown', () => {
  const now = performance.now();
  if (now - lastCanvasTap < 300) needKey = true; else kickV = 1;
  lastCanvasTap = now;
});
$('kickBtn').addEventListener('pointerdown', ev => { ev.preventDefault(); kickV = 1; });

/* ================= notices ================= */
function showNotice(html) { const n = $('notice'); n.innerHTML = html; n.hidden = false; }
function hideNotice() { $('notice').hidden = true; }
$('notice').addEventListener('click', ev => { if (ev.target === $('notice')) hideNotice(); });

/* ================= capture ================= */
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Segnale Rotto' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('snapBtn').onclick = () => canvas.toBlob(b => b && shareOrDownload(b, 'segnale-rotto-' + stamp() + '.png'), 'image/png');

let recorder = null, recStart = 0, chunks = [], clipBlob = null, clipName = '', micStream = null;
function pickMime() {
  if (!window.MediaRecorder) return null;
  const opts = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of opts) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
$('recBtn').onclick = async () => {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  const mime = pickMime();
  if (mime === null || !canvas.captureStream) { showNotice('Questo browser non può registrare video. Usa <b>Foto</b>.'); return; }
  const st = canvas.captureStream(30);
  if (S.mic) {
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); micStream.getAudioTracks().forEach(tr => st.addTrack(tr)); }
    catch (e) { showNotice('Microfono non disponibile: registro senza audio.'); }
  }
  try { recorder = new MediaRecorder(st, mime ? { mimeType: mime, videoBitsPerSecond: S.hd ? 8e6 : 3e6 } : undefined); }
  catch (e) { showNotice('Registrazione non disponibile su questo browser.'); return; }
  const ext = (recorder.mimeType || mime).includes('mp4') ? 'mp4' : 'webm';
  chunks = [];
  recorder.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
  recorder.onstop = () => {
    $('recBtn').classList.remove('on'); $('recBadge').hidden = true;
    if (micStream) { micStream.getTracks().forEach(tr => tr.stop()); micStream = null; }
    clipBlob = new Blob(chunks, { type: recorder.mimeType || 'video/' + ext });
    clipName = 'segnale-rotto-' + stamp() + '.' + ext;
    const v = $('clipVid'); if (v.src) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(clipBlob); v.play().catch(() => {});
    $('dlClip').href = v.src; $('dlClip').download = clipName;
    const secs = Math.round((performance.now() - recStart) / 1000);
    $('clipInfo').textContent = `${secs} s · ${(clipBlob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()} · ${W}×${H}`;
    $('sheet').hidden = false;
  };
  recorder.start(500); recStart = performance.now();
  $('recBtn').classList.add('on'); $('recBadge').hidden = false; $('recTime').textContent = '00:00';
};
$('shareClip').onclick = () => clipBlob && shareOrDownload(clipBlob, clipName);
$('closeSheet').onclick = () => { $('sheet').hidden = true; $('clipVid').pause(); };

/* ================= install, wake lock, offline ================= */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); deferredInstall = ev; $('installBtn').hidden = false; });
$('installBtn').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('installBtn').hidden = true; };
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let wake = null;
async function requestWake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && source === 'cam') requestWake(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

/* ================= boot ================= */
renderChips(); renderCard(); renderTop();
requestAnimationFrame(frame);
startCamera().then(() => {
  if (isIOS && !standalone && source === 'cam') {
    let seen = false; try { seen = localStorage.getItem('sr-ios-hint'); } catch (e) {}
    if (!seen) {
      showNotice('Per installarla: tocca <b>Condividi</b> in Safari, poi <b>Aggiungi alla schermata Home</b>.<br><button class="pill" id="okHint">Ok</button>');
      $('okHint').onclick = () => { hideNotice(); try { localStorage.setItem('sr-ios-hint', 1); } catch (e) {} };
    }
  }
});
})();
