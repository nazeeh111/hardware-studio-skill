const schema = 'hardware-studio-tray-v1';
const finite = (value, name, min = 0, max = 500) => {
  const number = Number(value);
  if (value === '' || value == null || typeof value === 'boolean' || !Number.isFinite(number) || number <= min || number > max) throw new Error(`${name} must be above ${min} and at most ${max} mm.`);
  return number;
};
const optional = (value, name, max = 20) => value === '' || value == null ? null : finite(value, name, 0, max);

export function validateTraySpec(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== schema || raw.units !== 'mm') throw new Error('Use hardware-studio-tray-v1 with millimeter units.');
  const outer = raw.outer || {};
  const length = finite(outer.length, 'Length');
  const width = finite(outer.width, 'Width');
  const height = finite(outer.height, 'Height');
  const wall = finite(raw.wall, 'Wall', 0, 20);
  const floor = finite(raw.floor, 'Floor', 0, 20);
  if (length <= 2 * wall + 2 || width <= 2 * wall + 2 || height <= floor + 1) throw new Error('Walls or floor consume the usable cavity.');
  if (!Array.isArray(raw.mounts) || raw.mounts.length > 100 || !Array.isArray(raw.cutouts) || raw.cutouts.length > 20) throw new Error('Mounts and cutouts must be bounded arrays.');
  const ids = new Set();
  const mounts = raw.mounts.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`Boss ${i + 1} is invalid.`);
    if (typeof item.id !== 'string') throw new Error(`Boss ${i + 1} needs a text ID.`);
    const id = item.id.trim();
    if (!id || id.length > 80 || ids.has(id)) throw new Error(`Boss ${i + 1} needs a unique ID under 81 characters.`);
    ids.add(id);
    const x = finite(item.x, `${id} X`), y = finite(item.y, `${id} Y`);
    const bossRadius = finite(item.bossRadius, `${id} radius`, 0, 40);
    const bossTopZ = finite(item.bossTopZ, `${id} top`);
    if (bossTopZ <= floor || bossTopZ >= height || !(wall + bossRadius < x && x < length - wall - bossRadius && wall + bossRadius < y && y < width - wall - bossRadius)) throw new Error(`${id} is outside the cavity or its top is outside the tray.`);
    const locatorRadius = optional(item.locatorRadius, `${id} locator radius`);
    const locatorHeight = optional(item.locatorHeight, `${id} locator height`);
    const holeRadius = optional(item.holeRadius, `${id} hole radius`);
    if ((locatorRadius == null) !== (locatorHeight == null) || (locatorRadius != null && holeRadius != null)) throw new Error(`${id} needs a complete locator pair or a through-hole, not both.`);
    if (locatorRadius != null && (locatorRadius >= bossRadius - .5 || bossTopZ + locatorHeight >= height)) throw new Error(`${id} locator is too wide or too tall.`);
    if (holeRadius != null && holeRadius >= bossRadius - .8) throw new Error(`${id} through-hole leaves too little boss wall.`);
    return { id, x, y, bossRadius, bossTopZ, ...(locatorRadius == null ? {} : { locatorRadius, locatorHeight }), ...(holeRadius == null ? {} : { holeRadius }) };
  });
  for (let i = 0; i < mounts.length; i++) for (let j = i + 1; j < mounts.length; j++) {
    if (Math.hypot(mounts[i].x - mounts[j].x, mounts[i].y - mounts[j].y) <= mounts[i].bossRadius + mounts[j].bossRadius + .1) throw new Error(`Bosses ${mounts[i].id} and ${mounts[j].id} overlap.`);
  }
  const cutouts = raw.cutouts.map((item, i) => {
    if (!item || !['left', 'right', 'front', 'back'].includes(item.edge)) throw new Error(`Opening ${i + 1} needs a valid edge.`);
    const span = ['left', 'right'].includes(item.edge) ? width : length;
    const start = finite(item.start, `Opening ${i + 1} start`, -1, span);
    const end = finite(item.end, `Opening ${i + 1} end`, 0, span);
    const bottom = finite(item.bottom, `Opening ${i + 1} bottom`, 0, height);
    const top = finite(item.top, `Opening ${i + 1} top`, 0, height);
    if (start < wall || end > span - wall || start >= end || bottom < floor || bottom >= top) throw new Error(`Opening ${i + 1} crosses a corner or floor.`);
    return { edge: item.edge, start, end, bottom, top };
  });
  let lid = null;
  if (raw.lid != null) {
    if (typeof raw.lid !== 'object' || Array.isArray(raw.lid)) throw new Error('Cover must be an object of millimeter dimensions.');
    const thickness = finite(raw.lid.thickness, 'Cover thickness', .5, 20);
    const skirtDepth = finite(raw.lid.skirtDepth, 'Cover skirt depth', .5, 20);
    const skirtWall = finite(raw.lid.skirtWall, 'Cover skirt wall', .5, 10);
    const clearance = finite(raw.lid.clearance, 'Cover side clearance', 0, 5);
    if (skirtDepth >= height - floor || length + 2 * (clearance + skirtWall) > 500 || width + 2 * (clearance + skirtWall) > 500) throw new Error('Cover skirt reaches the floor or its outside envelope exceeds 500 mm.');
    let window = null;
    if (raw.lid.window != null) {
      if (typeof raw.lid.window !== 'object' || Array.isArray(raw.lid.window)) throw new Error('Cover window must be a measured rectangle.');
      const x = finite(raw.lid.window.x, 'Window X');
      const y = finite(raw.lid.window.y, 'Window Y');
      const windowLength = finite(raw.lid.window.length, 'Window length', 2);
      const windowWidth = finite(raw.lid.window.width, 'Window width', 2);
      if (x < wall + 1 || y < wall + 1 || x + windowLength > length - wall - 1 || y + windowWidth > width - wall - 1) throw new Error('Cover window must leave at least 1 mm of plate inside every tray wall.');
      window = { x, y, length: windowLength, width: windowWidth };
    }
    lid = { thickness, skirtDepth, skirtWall, clearance, window };
  }
  return { schema, title: String(raw.title || 'Tray study').trim().slice(0, 100), units: 'mm', outer: { length, width, height }, wall, floor, cutouts, mounts, lid };
}

