/**
 * Package the plugin into `comment-translator.zip` for Acode's
 * "install from file" flow.
 *
 * Written with node's zlib instead of shelling out to `zip`, because `zip` is
 * not present on every device (it is missing on a stock Termux install).
 *
 * Entries are stored with fixed metadata so repeated runs produce an identical
 * archive — handy for verifying that a rebuild really changed nothing.
 */
import { deflateRawSync } from 'zlib';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Acode needs exactly these at the archive root. */
const FILES = ['plugin.json', 'icon.png', 'readme.md', 'dist/main.js'];
const OUT = path.join(here, 'comment-translator.zip');

/* ---- CRC-32 (needed by the zip format) ---- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---- collect entries ---- */
const missing = FILES.filter(f => !existsSync(path.join(here, f)));
if (missing.length) {
  console.error(`✗ missing file(s): ${missing.join(', ')}\n  Run \`npm run build\` first.`);
  process.exit(1);
}

const local = [];
const central = [];
let offset = 0;
const DOS_TIME = 0; // fixed → reproducible archives
const DOS_DATE = (2025 - 1980) << 9 | (1 << 5) | 1; // 2025-01-01

for (const name of FILES) {
  const data = readFileSync(path.join(here, name));
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const deflated = deflateRawSync(data, { level: 9 });

  // Store uncompressed when deflating does not help (e.g. the PNG icon).
  const store = deflated.length >= data.length;
  const payload = store ? data : deflated;
  const method = store ? 0 : 8;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(DOS_TIME, 10);
  localHeader.writeUInt16LE(DOS_DATE, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  local.push(localHeader, nameBuf, payload);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt16LE(DOS_TIME, 12);
  centralHeader.writeUInt16LE(DOS_DATE, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(payload.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra
  centralHeader.writeUInt16LE(0, 32); // comment
  centralHeader.writeUInt16LE(0, 34); // disk
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(offset, 42);

  central.push(centralHeader, nameBuf);
  offset += localHeader.length + nameBuf.length + payload.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(FILES.length, 8);
end.writeUInt16LE(FILES.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

const zip = Buffer.concat([...local, centralBuf, end]);
writeFileSync(OUT, zip);

const sha = createHash('sha256').update(zip).digest('hex').slice(0, 12);
console.log(`✓ ${path.basename(OUT)}  ${(zip.length / 1024).toFixed(1)}kb  sha256:${sha}`);
for (const name of FILES) {
  console.log(`    ${name}`);
}
