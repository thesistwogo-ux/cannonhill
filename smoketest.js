// Headless smoke test: runs game.js under DOM stubs and drives the simulation
// to surface runtime errors without a browser.
const fs = require('fs'), vm = require('vm');

function fakeEl() {
  const el = {
    style: {}, classList: { add(){}, remove(){}, contains(){return false;} },
    addEventListener(){}, appendChild(){}, removeEventListener(){},
    textContent: '', innerHTML: '', checked: false, disabled: false,
    set onclick(v){}, set onchange(v){}, getContext: () => fakeCtx(),
    width:0, height:0, querySelectorAll(){return [];},
  };
  return el;
}
function fakeCtx() {
  return new Proxy({
    canvas: { width: 640, height: 480 },
    createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h }),
    createLinearGradient: () => ({ addColorStop(){} }),
    getImageData: (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4) }),
    putImageData(){}, drawImage(){}, fillRect(){}, clearRect(){}, fill(){}, stroke(){},
    beginPath(){}, moveTo(){}, lineTo(){}, arc(){}, ellipse(){}, save(){}, restore(){},
    translate(){}, setTransform(){}, fillText(){},
  }, { get(t,p){ return p in t ? t[p] : (t[p]=()=>{}); }, set(){return true;} });
}

const docEls = {};
const document = {
  getElementById: id => docEls[id] || (docEls[id] = fakeEl()),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  addEventListener(){},
};
const listeners = {};
const window = {
  innerWidth: 800, innerHeight: 400,
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  AudioContext: function(){ return { currentTime:0, destination:{},
    createOscillator:()=>({connect(){}, frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}}, start(){}, stop(){}, type:''}),
    createGain:()=>({connect(){}, gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}}) }; },
};
const sandbox = {
  window, document, navigator: {}, console,
  requestAnimationFrame: () => 0,        // don't auto-loop
  setInterval: () => 0, setTimeout: () => 0, clearInterval(){}, clearTimeout(){},
  Math, Date, Uint8Array, Uint32Array, Uint8ClampedArray, Float64Array, JSON,
};
sandbox.globalThis = sandbox;

let code = fs.readFileSync('game.js', 'utf8');
code += `\n;this.__h = { st:()=>state, tanks:()=>tanks, shots:()=>shots, mat:()=>mat,
  startGame:()=>startGame, simStep:()=>simStep, fire:()=>fire, weapons:()=>WEAPONS,
  setH:(h,a)=>{humanCount=h;aiCount=a;}, setState:(s)=>{state=s;} };`;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'game.js' });

// fire the 'load' event to run boot()
(listeners.load || []).forEach(fn => fn());
const h = sandbox.__h;
console.log('booted OK, state =', h.st());

// start a game with 1 human + 3 AI
h.setH(1, 3);
h.startGame()();
console.log('after startGame: state =', h.st(), 'tanks =', h.tanks().length,
  'hp =', h.tanks().map(t=>t.hp));

// verify terrain actually generated (non-empty material)
let solidCount = 0; const m = h.mat();
for (let i = 0; i < m.length; i++) if (m[i]) solidCount++;
console.log('terrain solid pixels =', solidCount, solidCount > 50000 ? 'OK' : 'TOO FEW!');

// make the human fire a few weapons of each kind
const human = h.tanks().find(t=>t.human);
const sim = h.simStep();
let errors = 0;
for (const w of [3,1,4,6,5,7,12,2,10,9,11,8]) {
  try {
    human.weapon = w; human.ammo[w] = 5; human.charge = 30; human.angle = 60;
    h.fire()(human);
  } catch (e) { console.error('FIRE weapon', w, 'threw:', e.message); errors++; }
}
console.log('shots in flight after firing all weapons =', h.shots().length);

// make ALL tanks AI so the battle resolves on its own
h.tanks().forEach(t => { t.human = false; t.computer = true; });
h.shots().length = 0;

// run the simulation; ensure no throw and the round actually resolves
let steps = 0, reachedRoundEnd = false;
try {
  for (let i = 0; i < 6000; i++) {
    sim(); steps++;
    if (h.st() === 3) { reachedRoundEnd = true; break; }  // S_ROUND end
  }
} catch (e) { console.error('simStep threw at step', steps, ':', e.message, '\n', e.stack); errors++; }
const alive = h.tanks().filter(t=>t.active).length;
console.log('ran', steps, 'sim steps; alive tanks =', alive,
  '; final HP =', h.tanks().map(t=>t.hp|0));
console.log('round resolved to a winner:', reachedRoundEnd ? 'YES ✅' : 'NO (stalemate) ⚠️');
if (!reachedRoundEnd && alive > 1) errors++;  // AI failed to land lethal hits

console.log(errors === 0 ? '\nSMOKE TEST PASSED ✅' : `\nSMOKE TEST FAILED ❌ (${errors} errors)`);
process.exit(errors ? 1 : 0);
