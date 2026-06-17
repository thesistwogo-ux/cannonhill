// Runs the real game.js headless, then renders its world buffers to a PNG so we
// can eyeball terrain / tanks / projectiles without a browser.
const fs = require('fs'), vm = require('vm'), zlib = require('zlib');

//---- PNG writer ----
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return(~c)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const ty=Buffer.from(t,'ascii');const body=Buffer.concat([ty,d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(body),0);return Buffer.concat([l,body,cr]);}
function writePNG(file,w,h,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;const st=w*4;const raw=Buffer.alloc((st+1)*h);for(let y=0;y<h;y++){raw[y*(st+1)]=0;rgba.copy(raw,y*(st+1)+1,y*st,y*st+st);}fs.writeFileSync(file,Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:6})),chunk('IEND',Buffer.alloc(0))]));}

//---- DOM stubs (same as smoke test) ----
function fakeEl(){return{style:{},classList:{add(){},remove(){},contains(){return false;}},addEventListener(){},appendChild(){},textContent:'',innerHTML:'',checked:false,disabled:false,set onclick(v){},set onchange(v){},getContext:()=>fakeCtx(),querySelectorAll(){return[];}};}
function fakeCtx(){return new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createLinearGradient:()=>({addColorStop(){}})},{get(t,p){return p in t?t[p]:(t[p]=()=>{});},set(){return true;}});}
const docEls={};const document={getElementById:id=>docEls[id]||(docEls[id]=fakeEl()),querySelectorAll:()=>[],createElement:()=>fakeEl(),addEventListener(){}};
const listeners={};const window={innerWidth:800,innerHeight:400,addEventListener:(e,f)=>{(listeners[e]=listeners[e]||[]).push(f);},AudioContext:function(){return{currentTime:0,destination:{},createOscillator:()=>({connect(){},frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},start(){},stop(){}}),createGain:()=>({connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}})};}};
const sandbox={window,document,navigator:{},console,requestAnimationFrame:()=>0,setInterval:()=>0,setTimeout:()=>0,Math,Date,Uint8Array,Uint32Array,Uint8ClampedArray,JSON};
sandbox.globalThis=sandbox;

let code=fs.readFileSync('game.js','utf8');
code+=`\n;this.__h={tanks:()=>tanks,shots:()=>shots,fx:()=>fx,mat:()=>mat,MAT:()=>MAT,wind:()=>wind,round:()=>round,maxRounds:()=>maxRounds,
  setH:(h,a)=>{humanCount=h;aiCount=a;},startGame:()=>startGame,simStep:()=>simStep,cannonTip:()=>cannonTip};`;
vm.createContext(sandbox);vm.runInContext(code,sandbox,{filename:'game.js'});
(listeners.load||[]).forEach(f=>f());
const h=sandbox.__h;
h.setH(1,3); h.startGame()();
const sim=h.simStep();
const N = parseInt(process.argv[2]||'40');
for(let i=0;i<N;i++) sim();

//---- render world to RGBA ----
const W=640,H=480;const img=Buffer.alloc(W*H*4);
const set=(x,y,r,g,b,a=255)=>{x|=0;y|=0;if(x<0||x>=W||y<0||y>=H)return;const o=(y*W+x)*4;const ia=a/255,na=1-ia;img[o]=r*ia+img[o]*na;img[o+1]=g*ia+img[o+1]*na;img[o+2]=b*ia+img[o+2]*na;img[o+3]=255;};
// sky
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=y/H;set(x,y,43+(207-43)*t,111+(230-111)*t,214+(251-214)*t);}
// clouds
function cloud(cx,cy,s){for(let y=-20;y<=20;y++)for(let x=-70;x<=70;x++){const e=(x*x)/(60*s*60*s)+(y*y)/(18*s*18*s);if(e<=1)set(cx+x,cy+y,255,255,255,120);}}
cloud(110,90,1.1);cloud(430,70,0.8);
// terrain from mat buffer
const mat=h.mat(),MAT=h.MAT();
for(let i=0;i<mat.length;i++){const m=mat[i];if(!m)continue;const c=MAT[m];if(!c)continue;set(i%W,(i/W)|0,c.r,c.g,c.b);}
// fx
for(const f of h.fx())set(f.x,f.y,f.r,f.g,f.b,200);
// shots
for(const s of h.shots()){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)set(s.x+dx,s.y+dy,20,20,20);}
// tanks
const tip=h.cannonTip();
for(const t of h.tanks()){if(!t.active)continue;const c=t.color;
  for(let y=-8;y<-1;y++)for(let x=-10;x<=10;x++)set(t.x+x,t.y+y,c.r,c.g,c.b);
  for(let y=-3;y<1;y++)for(let x=-11;x<=11;x++)set(t.x+x,t.y+y,c.r*0.7,c.g*0.7,c.b*0.7);
  const tp=tip(t);const steps=24;for(let s=0;s<=steps;s++){const x=t.x+(tp.x-t.x)*s/steps;const y=(t.y-10)+(tp.y-(t.y-10))*s/steps;for(let w=-1;w<=1;w++)for(let hh=-1;hh<=1;hh++)set(x+w,y+hh,30,30,30);}
  // health bar
  for(let x=0;x<22;x++)for(let y=0;y<6;y++)set(t.x-11+x,t.y+4+y,235,235,235);
  for(let x=0;x<20;x++)for(let y=0;y<4;y++)set(t.x-10+x,t.y+5+y,192,57,43);
  const hpw=(20*t.hp/1000)|0;for(let x=0;x<hpw;x++)for(let y=0;y<4;y++)set(t.x-10+x,t.y+5+y,39,174,96);
}
writePNG('preview.png',W,H,img);
console.log('wrote preview.png after',N,'sim steps; alive=',h.tanks().filter(t=>t.active).length,'shots=',h.shots().length,'wind=',h.wind().toFixed(2));
