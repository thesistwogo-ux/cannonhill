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
  const fill = (x0,y0,bw,bh,r,g,b)=>{ for(let y=0;y<bh;y++)for(let x=0;x<bw;x++) set(Math.round(x0)+x,Math.round(y0)+y,r,g,b); };
  const disc = (cx,cy,rad,r,g,b)=>{ const R=Math.round(rad); for(let y=-R;y<=R;y++)for(let x=-R;x<=R;x++) if(x*x+y*y<=R*R) set(Math.round(cx)+x,Math.round(cy)+y,r,g,b); };
  const dome = (cx,cy,rad,r,g,b)=>{ const R=Math.round(rad); for(let y=-R;y<=0;y++)for(let x=-R;x<=R;x++) if(x*x+y*y<=R*R) set(Math.round(cx)+x,Math.round(cy)+y,r,g,b); };

  const RED=[220,40,40], DRED=[150,28,28], TRACK=[60,60,64], WHEEL=[30,30,34], CAN=[28,28,28];
  // tracks (dark treads with rounded ends) + road wheels
  fill(tx-8*u, ty+0.8*u, 16*u, 3*u, ...TRACK);
  disc(tx-8*u, ty+2.3*u, 1.5*u, ...TRACK);
  disc(tx+8*u, ty+2.3*u, 1.5*u, ...TRACK);
  for (let i=0;i<5;i++) disc(tx + (-6.4 + i*3.2)*u, ty+2.3*u, 1.0*u, ...WHEEL);
  // hull (red) with a darker lower strip
  fill(tx-7*u, ty-1.4*u, 14*u, 3.0*u, ...RED);
  fill(tx-7.5*u, ty+0.4*u, 15*u, 1.2*u, ...DRED);
  // turret: red dome on a short base block
  fill(tx-4*u, ty-1.9*u, 8*u, 1.2*u, ...RED);
  dome(tx, ty-1.7*u, 4.2*u, ...RED);
  // cannon barrel, angled up-right (~40°) from the turret
  const ang = 40*Math.PI/180, cl = Math.round(11*u), bx = tx, by = ty-3.4*u;
  for (let i=0;i<cl;i++) disc(bx+Math.cos(ang)*i, by-Math.sin(ang)*i, 0.85*u, ...CAN);
  disc(bx+Math.cos(ang)*cl, by-Math.sin(ang)*cl, 1.0*u, ...CAN);
  // a little shell arc of dots
  for (let i=0;i<7;i++){
    const px = bx + Math.cos(ang)*cl + i*size*0.05;
    const py = by - Math.sin(ang)*cl - i*size*0.028 + i*i*size*0.006;
    disc(px, py, 1.1*u, 255,220,80);
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
