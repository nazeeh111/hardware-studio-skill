// Minimal, uncompressed ZIP writer for small project exports. No runtime dependencies.
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return { date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(), time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1) };
}

export function createZip(entries, timestamp = new Date()) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 65535 || !(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) throw new Error('Invalid ZIP entries or timestamp.');
  const local = [], central = [], seen = new Set();
  const time = dosDateTime(timestamp);
  let offset = 0, centralSize = 0;
  for (const entry of entries) {
    const name = entry?.name;
    if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.split('/').some(segment => !segment || segment === '.' || segment === '..') || seen.has(name)) throw new Error('Unsafe or duplicate ZIP path.');
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    if (!(data instanceof Uint8Array) || nameBytes.length > 65535 || data.length > 0xffffffff) throw new Error('ZIP entry is too large or invalid.');
    const checksum = crc32(data);
    const localBytes = new Uint8Array(30 + nameBytes.length);
    const lh = new DataView(localBytes.buffer);
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time.time, true); lh.setUint16(12, time.date, true);
    lh.setUint32(14, checksum, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true); localBytes.set(nameBytes, 30);
    const centralBytes = new Uint8Array(46 + nameBytes.length);
    const ch = new DataView(centralBytes.buffer);
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time.time, true); ch.setUint16(14, time.date, true);
    ch.setUint32(16, checksum, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true); ch.setUint32(42, offset, true); centralBytes.set(nameBytes, 46);
    local.push(localBytes, data); central.push(centralBytes);
    offset += localBytes.length + data.length; centralSize += centralBytes.length;
    if (offset + centralSize + 22 > 0xffffffff) throw new Error('ZIP package exceeds the classic ZIP size limit.');
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const chunk of [...local, ...central, end]) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}
