// Génère assets/logo.png : logo recadré (marges transparentes retirées), agrandi à 512×512 et blanc.
// Usage : npx electron scripts/make-white-logo.js
const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 512; // taille finale du canevas (carré)
const MARGIN = 0.03; // marge autour du logo (3 % de chaque côté)
const FILE = path.join(__dirname, "..", "assets", "logo.png");

// Vérifie si Electron interprète les bitmaps comme « alpha prémultiplié » (pour choisir le bon blanc).
function isPremultiplied() {
  const png = nativeImage.createFromBitmap(Buffer.from([128, 128, 128, 128]), { width: 1, height: 1 }).toPNG();
  const idat = [];
  for (let pos = 8; pos < png.length; ) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    if (type === "IDAT") idat.push(png.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)); // octet 0 = filtre, puis R, G, B, A
  return raw[1] > 200;
}

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(FILE);
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();

  // Rectangle englobant des pixels visibles
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bmp[(y * width + x) * 4 + 3] > 8) {
 if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  // Recadrage puis agrandissement pour remplir le canevas
  const cropped = img.crop({ x: minX, y: minY, width: bw, height: bh });
  const scale = (SIZE * (1 - 2 * MARGIN)) / Math.max(bw, bh);
  const rw = Math.round(bw * scale);
  const rh = Math.round(bh * scale);
  const resized = cropped.resize({ width: rw, height: rh, quality: "best" });
  const src = resized.toBitmap();

  // Mise en blanc (on garde la transparence d'origine) et centrage sur le canevas
  const premul = isPremultiplied();
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const offX = Math.floor((SIZE - rw) / 2);
  const offY = Math.floor((SIZE - rh) / 2);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const a = src[(y * rw + x) * 4 + 3];
      if (a === 0) continue;
      const j = ((y + offY) * SIZE + (x + offX)) * 4;
      const v = premul ? a : 255;
      out[j] = out[j + 1] = out[j + 2] = v;
      out[j + 3] = a;
    }
  }

  fs.writeFileSync(FILE, nativeImage.createFromBitmap(out, { width: SIZE, height: SIZE }).toPNG());
  console.log(JSON.stringify({ ancien: [width, height], bbox: [minX, minY, maxX, maxY], logo: [rw, rh], premultiplie: premul }));
  app.quit();
});
