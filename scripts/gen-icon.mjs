/**
 * Generates a minimal but valid 32x32 32-bit .ico file for the Windows
 * installer, so `tauri build` can bundle without external assets.
 * Run once: `node scripts/gen-icon.mjs` (npm run icon).
 * Replace with real brand art later — any .ico with 256px sizes is fine.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname("");
const outDir = join("scripts", "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const W = 32, H = 32;
// Background #1e40af, BGRA pixels, bottom-up.
const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = ((H - 1 - y) * W + x) * 4;
    px[i] = 0xaf; // B
    px[i + 1] = 0x40; // G
    px[i + 2] = 0x1e; // R
    px[i + 3] = 0xff; // A
  }
}
// White "L" block so the icon isn't a plain square.
for (let y = 8; y < 24; y++) {
  for (let x = 9; x < 13; x++) {
    const i = ((H - 1 - y) * W + x) * 4;
    px[i] = 0xff; px[i + 1] = 0xff; px[i + 2] = 0xff; px[i + 3] = 0xff;
  }
}
for (let y = 20; y < 24; y++) {
  for (let x = 9; x < 23; x++) {
    const i = ((H - 1 - y) * W + x) * 4;
    px[i] = 0xff; px[i + 1] = 0xff; px[i + 2] = 0xff; px[i + 3] = 0xff;
  }
}

const bmpInfoHeader = Buffer.alloc(40);
bmpInfoHeader.writeUInt32LE(40, 0);      // header size
bmpInfoHeader.writeInt32LE(W, 4);        // width
bmpInfoHeader.writeInt32LE(H * 2, 8);    // height (XOR + AND masks)
bmpInfoHeader.writeUInt16LE(1, 12);      // planes
bmpInfoHeader.writeUInt16LE(32, 14);     // bpp
bmpInfoHeader.writeUInt32LE(0, 16);      // BI_RGB
bmpInfoHeader.writeUInt32LE(px.length, 20);

// AND mask: 1bpp, all transparent (alpha channel rules).
const maskRow = Math.ceil(W / 32) * 4;
const andMask = Buffer.alloc(maskRow * H);

const image = Buffer.concat([bmpInfoHeader, px, andMask]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count

const entry = Buffer.alloc(16);
entry[0] = W; entry[1] = H; entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(22, 12); // data offset

writeFileSync(join(outDir, "icon.ico"), Buffer.concat([header, entry, image]));
console.log(`Wrote ${join(outDir, "icon.ico")} (${22 + image.length} bytes)`);
