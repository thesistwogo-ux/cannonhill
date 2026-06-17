// Generates PNG app icons without external deps — hand-rolled minimal PNG writer.
const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, w, h, rgba) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const stride = w*4;
  const raw = Buffer.alloc((stride+1)*h);
  for (let y=0; y<h; y++) { raw[y*(stride+1)]=0; rgba.copy(raw, y*(stride+1)+1, y*stride, y*stride+stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

function draw(size, maskable) {
  const W = size, H = size;
  const buf = Buffer.alloc(W*H*4);
  const set = (x,y,r,g,b,a=255) => { if(x<0||x>=W||y<0||y>=H)return; const o=(y*W+x)*4; buf[o]=r;buf[o+1]=g;buf[o+2]=b;buf[o+3]=a; };
  const pad = maskable ? size*0.0 : 0; // background fills whole canvas anyway

  // sky gradient background
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const t = y/H;
    const r = Math.round(20 + (120-20)*t);
    const g = Math.round(58 + (180-58)*t);
    const b = Math.round(110 + (240-110)*t);
    set(x,y,r,g,b);
  }
  // mountain (snow-capped) — a smooth hill curve
  const baseY = H*0.92;
  for (let x=0;x<W;x++){
    const nx = x/W;
    const hill = H*0.42 + Math.sin(nx*Math.PI)* -H*0.30 + Math.sin(nx*7)*H*0.02;
    const top = Math.round(hill);
    for (let y=top;y<H;y++){
      let r,g,b;
      if (y < top + size*0.05) { r=255;g=255;b=255; }            // snow
      else if (y < top + size*0.09) { r=0;g=150;b=0; }            // grass
      else if (y < top + size*0.22) { r=140;g=111;b=50; }         // earth
      else { r=120;g=120;b=120; }                                  // stone
      set(x,y,r,g,b);
    }
  }
  // tank near the summit
  const tx = Math.round(W*0.5), ty = Math.round(baseY - H*0.40);
  const u = size/24;
  const fill = (x0,y0,bw,bh,r,g,b)=>{ for(let y=0;y<bh;y++)for(let x=0;x<bw;x++) set(x0+x,y0+y,r,g,b); };
  fill(Math.round(tx-5*u), Math.round(ty-2*u), Math.round(10*u), Math.round(3.5*u), 220,40,40);
  fill(Math.round(tx-6*u), Math.round(ty+1.2*u), Math.round(12*u), Math.round(2.2*u), 150,28,28);
  // turret + cannon (45°)
  const cl = Math.round(9*u);
  for (let i=0;i<cl;i++){
    const cx = Math.round(tx + i*0.8), cy = Math.round(ty-2*u - i*0.8);
    for (let w=-1;w<=1;w++) for (let h=-1;h<=1;h++) set(cx+w,cy+h,30,30,30);
  }
  // a little shell arc of dots
  for (let i=0;i<7;i++){
    const px = Math.round(tx + cl*0.8 + i*size*0.045);
    const py = Math.round(ty-2*u - cl*0.8 - i*size*0.03 + i*i*size*0.006);
    for (let w=-1;w<=1;w++) for (let h=-1;h<=1;h++) set(px+w,py+h,255,220,80);
  }
  return buf;
}

for (const [name, size, maskable] of [
  ['icon-180.png',180,false], ['icon-192.png',192,false],
  ['icon-512.png',512,false], ['icon-512-maskable.png',512,true],
]) {
  writePNG('icons/'+name, size, size, draw(size, maskable));
  console.log('wrote icons/'+name);
}
