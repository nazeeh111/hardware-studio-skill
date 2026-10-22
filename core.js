import { validateTraySpec } from './tray-spec.js';

export const STORAGE_KEY = 'hardware-studio-projects-v1';
export const REVISIONS_KEY = 'hardware-studio-revisions-v1';
export const MAX_REFERENCE_DATA_URL = 250_000;

function safeTextList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 160 || /[\r\n]/.test(item))) throw new Error(`${label} must contain up to 30 short text entries.`);
  return value.map(item => item.trim());
}

function safeStepPartIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 40 || value.some(id => typeof id !== 'string' || !id || id.length > 80) || new Set(value).size !== value.length) throw new Error('Step part links must be unique part IDs.');
  return [...value];
}

export function safeReferenceImage(input) {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || typeof input.name !== 'string' || typeof input.dataUrl !== 'string' ||
      input.name.length > 120 || input.dataUrl.length > MAX_REFERENCE_DATA_URL ||
      !/^data:image\/jpeg;base64,\/9j\/(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataUrl)) {
    throw new Error('The reference image must be a small JPEG saved by this app.');
  }
  return { name: input.name, dataUrl: input.dataUrl };
}

export function projectContentChanged(before, after) {
  const withoutTimestamp = project => { const { updatedAt, ...content } = project; return JSON.stringify(content); };
  return withoutTimestamp(before) !== withoutTimestamp(after);
}

export function parseSavedWorkspace(raw) {
  const saved = JSON.parse(raw);
  if (!Array.isArray(saved?.projects) || !saved.projects.length || saved.projects.some(project =>
    !project || typeof project.id !== 'string' || !Array.isArray(project.parts) || !Array.isArray(project.wires) || !Array.isArray(project.steps) ||
    project.parts.some(part => !part || typeof part !== 'object') || project.wires.some(wire => !wire || typeof wire !== 'object') || project.steps.some(step => !step || typeof step !== 'object') ||
    (project.mechanicalConnections != null && (!Array.isArray(project.mechanicalConnections) || project.mechanicalConnections.some(link => !link || typeof link !== 'object'))) ||
    (project.powerRails != null && (!Array.isArray(project.powerRails) || project.powerRails.some(rail => !rail || typeof rail !== 'object' || !Array.isArray(rail.loads) || rail.loads.some(load => !load || typeof load !== 'object')))))) throw new Error('Invalid saved workspace');
  saved.projects.forEach(project => {
    safeReferenceImage(project.referenceImage);
    if (project.traySpec != null) validateTraySpec(project.traySpec);
    safeTextList(project.tools, 'Tools');
    safeTextList(project.assumptions, 'Assumptions');
    project.steps.forEach(step => safeStepPartIds(step.partIds));
  });
  return saved;
}

export function setProjectTraySpec(project, input) {
  const next = input == null ? null : validateTraySpec(input);
  if (JSON.stringify(project.traySpec ?? null) === JSON.stringify(next)) return false;
  project.traySpec = next;
  project.review.mechanical = false;
  return true;
}

const part = (id, name, category, qty, unitCost, detail, voltage = '') => ({
  id, name, category, qty, unitCost, detail, voltage, sourceUrl: '', specUrl: '', checkedAt: '', verified: false
});

export const STARTERS = [
  {
    id: 'plant', name: 'Desk plant monitor', icon: '◌', tag: 'SENSING',
    prompt: 'A USB powered desk plant monitor with temperature, humidity, soil moisture and a small display.',
    summary: 'An ESP32 reads the room and soil, then shows the measurements on an I²C display. This is a concept design; choose exact modules and verify every pin and rating before wiring.',
    tools: ['Multimeter', 'Wire preparation tools', 'Calipers for the chosen enclosure and boards'],
    assumptions: ['Exact breakout modules, pinouts and supply ratings still need selection and review.', 'The enclosure must keep electronics protected from wet soil while exposing the room sensor.'],
    parts: [
      part('esp32', 'ESP32 DevKit board', 'Control', 1, 11, 'Choose a board with accessible 3.3 V, GND, GPIO21, GPIO22 and ADC1 GPIO34.', '3.3'),
      part('bme280', 'BME280 breakout', 'Sensor', 1, 8, 'Temperature and humidity sensor. Confirm breakout pinout and I²C address.', '3.3'),
      part('soil', 'Capacitive soil moisture sensor', 'Sensor', 1, 6, 'Confirm the chosen sensor can run at 3.3 V and its analog output stays in the ESP32 ADC range.', '3.3'),
      part('oled', 'SSD1306 I²C OLED module', 'Display', 1, 8, 'Choose a 3.3 V compatible module; verify its I²C address.', '3.3'),
      part('usb', 'USB power supply and cable', 'Power', 1, 9, 'Use a certified low voltage supply compatible with the selected ESP32 board.', '5'),
      part('case', 'Ventilated enclosure', 'Mechanical', 1, 8, 'Dimension to the actual board and connectors. Keep the humidity sensor exposed to room air.'),
      part('wire', 'Insulated hookup wire', 'Assembly', 1, 4, 'Estimate length and connector style after laying out the enclosure.')
    ],
    wires: [
      { from: 'esp32', to: 'bme280', signal: 'I²C SDA / GPIO21', voltage: '3.3 V', note: 'Shared bus; confirm board pin labels.' },
      { from: 'esp32', to: 'bme280', signal: 'I²C SCL / GPIO22', voltage: '3.3 V', note: 'Confirm pull-ups on breakout.' },
      { from: 'esp32', to: 'oled', signal: 'I²C SDA + SCL', voltage: '3.3 V', note: 'Share the bus; verify addresses do not conflict.' },
      { from: 'soil', to: 'esp32', signal: 'Analog / GPIO34', voltage: '0–3.3 V', note: 'Use ADC1 when Wi-Fi is enabled.' },
      { from: 'usb', to: 'esp32', signal: 'USB power', voltage: '5 V', note: 'Power through the board USB connector, not a 3.3 V pin.' }
    ],
    steps: [
      { phase: 'Prepare', title: 'Confirm exact modules', detail: 'Record datasheets, dimensions, connector orientation and voltage range for each purchased part.', partIds: ['esp32', 'bme280', 'soil', 'oled', 'usb'] },
      { phase: 'Prepare', title: 'Plan enclosure openings', detail: 'Leave access for USB and airflow to the BME280; protect the controller from wet soil.', partIds: ['case', 'esp32', 'bme280', 'usb'] },
      { phase: 'Wire', title: 'Connect the I²C bus', detail: 'With power disconnected, connect common ground, 3.3 V, SDA and SCL using verified module pinouts.', partIds: ['esp32', 'bme280', 'oled', 'wire'] },
      { phase: 'Wire', title: 'Connect the soil sensor', detail: 'Confirm its output is within the ADC input range, then connect to ADC1 GPIO34 and ground.', partIds: ['soil', 'esp32', 'wire'] },
      { phase: 'Bring up', title: 'Test one device at a time', detail: 'Power from USB, scan I²C addresses, compare room readings with a reference and calibrate soil readings in dry and wet conditions.', partIds: ['esp32', 'bme280', 'soil', 'oled', 'usb'] },
      { phase: 'Assemble', title: 'Fit and strain-relieve', detail: 'Mount components, route cables away from water and check that no connector is under tension.', partIds: ['case', 'esp32', 'bme280', 'soil', 'oled', 'wire'] }
    ]
  },
  {
    id: 'light', name: 'USB ambient light', icon: '✳', tag: 'LIGHTING',
    prompt: 'A USB powered ambient desk light with a button and individually addressable LEDs.',
    summary: 'An ESP32 controls a short 5 V LED strip through a level shifter. The wiring and power budget need checks against the exact strip, board and supply.',
    tools: ['Multimeter', 'Wire preparation tools', 'Calipers for the chosen strip and enclosure'],
    assumptions: ['Exact LED strip, controller, level shifter and supply ratings need verification.', 'Maximum current and heat must be measured for the chosen operating brightness.'],
    parts: [
      part('esp32', 'ESP32 DevKit board', 'Control', 1, 11, 'Choose an exact board and verify its USB power path and output GPIO.', '3.3'),
      part('led', '5 V addressable LED strip, 30 LEDs', 'Lighting', 1, 14, 'Choose a strip with documented current per LED and a 5 V data interface.', '5'),
      part('shift', '74AHCT125 level-shifter module', 'Control', 1, 5, 'Translate 3.3 V data to 5 V. Confirm module pinout and common ground.', '5'),
      part('res', '330 Ω resistor', 'Electrical', 1, 1, 'Series data resistor near the LED input; verify against the strip maker guidance.'),
      part('cap', '1000 µF capacitor, at least 6.3 V', 'Electrical', 1, 2, 'Place across LED supply at strip input; observe polarity.'),
      part('button', 'Momentary pushbutton', 'Input', 1, 2, 'Use a GPIO with an internal pull-up or add an external resistor.'),
      part('usb', '5 V USB power supply, 3 A rated', 'Power', 1, 12, 'Verify the worst-case LED current and cable rating before use.', '5'),
      part('case', 'Diffuser and enclosure', 'Mechanical', 1, 12, 'Dimension and material choice depend on the final strip and heat test.')
    ],
    wires: [
      { from: 'esp32', to: 'shift', signal: 'Data / GPIO18', voltage: '3.3 V', note: 'Check chosen level shifter input pin.' },
      { from: 'shift', to: 'res', signal: '5 V data', voltage: '5 V', note: 'Place resistor in series with the data line.' },
      { from: 'res', to: 'led', signal: 'DIN', voltage: '5 V', note: 'Connect at the marked strip input end.' },
      { from: 'usb', to: 'led', signal: '5 V + GND', voltage: '5 V', note: 'Use a common ground with the controller.' },
      { from: 'usb', to: 'esp32', signal: 'USB power', voltage: '5 V', note: 'Power via the ESP32 USB connector.' },
      { from: 'button', to: 'esp32', signal: 'GPIO27 to GND', voltage: '3.3 V logic', note: 'Enable pull-up in firmware.' }
    ],
    powerRails: [{ id: 'rail-5v', name: '5 V shared input', voltageV: 5, supplyCurrentMa: 3000, marginPercent: 20, sourcePartId: 'usb', loads: [{ partId: 'led', currentMaEach: null }, { partId: 'esp32', currentMaEach: null }] }],
    steps: [
      { phase: 'Prepare', title: 'Calculate power demand', detail: 'Use the chosen strip datasheet to compute maximum current. Compare with supply, cable and connector ratings.', partIds: ['led', 'usb', 'esp32'] },
      { phase: 'Prepare', title: 'Measure the fit', detail: 'Measure strip width, bend radius, board size and connector clearance before making the enclosure.', partIds: ['led', 'esp32', 'case'] },
      { phase: 'Wire', title: 'Build the data path', detail: 'With power disconnected, wire GPIO to level shifter, series resistor and strip DIN. Tie grounds together.', partIds: ['esp32', 'shift', 'res', 'led'] },
      { phase: 'Wire', title: 'Connect power', detail: 'Wire the strip directly to a suitable 5 V supply and the controller through its USB connector. Add the polarized input capacitor.', partIds: ['usb', 'led', 'esp32', 'cap'] },
      { phase: 'Bring up', title: 'Test at low brightness', detail: 'Start with a few LEDs and a current limit. Confirm data direction and measure supply voltage at the far end.', partIds: ['usb', 'led', 'esp32', 'shift'] },
      { phase: 'Assemble', title: 'Check heat and strain relief', detail: 'Run at expected brightness, inspect temperature and secure the cable entry.', partIds: ['led', 'case', 'usb'] }
    ]
  }
];

export function makeProject(starter, title) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: title || starter.name, brief: starter.prompt,
    summary: starter.summary, starterId: starter.id, createdAt: now, updatedAt: now,
    parts: structuredClone(starter.parts), wires: structuredClone(starter.wires), mechanicalConnections: structuredClone(starter.mechanicalConnections || []),
    steps: structuredClone(starter.steps).map((step, i) => ({ ...step, id: `step-${i + 1}`, partIds: step.partIds || [], done: false })),
    powerRails: structuredClone(starter.powerRails || []),
    tools: structuredClone(starter.tools || []), assumptions: structuredClone(starter.assumptions || []), notes: '', cadUrl: '', wiringUrl: '', referenceImage: null, traySpec: null, review: { electrical: false, mechanical: false, sourcing: false }
  };
}

export function blankProject(title = 'Untitled concept') {
  return {
    id: crypto.randomUUID(), title, brief: '', summary: 'Describe the intended function, constraints and operating environment.',
    starterId: 'blank', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    parts: [], wires: [], mechanicalConnections: [], steps: [], powerRails: [], tools: [], assumptions: [], notes: '', cadUrl: '', wiringUrl: '', referenceImage: null, traySpec: null,
    review: { electrical: false, mechanical: false, sourcing: false }
  };
}

export function stats(project) {
  return {
    distinctParts: project.parts.length,
    units: project.parts.reduce((sum, p) => sum + Number(p.qty || 0), 0),
    estimate: project.parts.reduce((sum, p) => sum + Number(p.qty || 0) * Number(p.unitCost || 0), 0),
    wires: project.wires.length,
    completed: project.steps.filter(s => s.done).length
  };
}

export function powerBudget(project, rail) {
  const parts = new Map(project.parts.map(part => [part.id, part]));
  const loads = (rail.loads || []).map(load => {
    const part = parts.get(load.partId);
    const current = load.currentMaEach == null || load.currentMaEach === '' ? null : Number(load.currentMaEach);
    return { part, currentMaEach: current, totalMa: part && Number.isFinite(current) && current >= 0 ? current * Number(part.qty) : null };
  });
  const knownDemandMa = loads.reduce((sum, load) => sum + (load.totalMa || 0), 0);
  const supplyMa = rail.supplyCurrentMa == null || rail.supplyCurrentMa === '' ? null : Number(rail.supplyCurrentMa);
  const complete = loads.length > 0 && loads.every(load => load.totalMa != null) && Number.isFinite(supplyMa) && supplyMa > 0;
  const marginPercent = Number(rail.marginPercent ?? 20);
  const headroomMa = complete ? supplyMa - knownDemandMa : null;
  const headroomPercent = complete ? headroomMa / supplyMa * 100 : null;
  const status = !complete ? 'incomplete' : headroomMa < 0 ? 'overload' : headroomPercent < marginPercent ? 'below-margin' : 'within-margin';
  return { loads, knownDemandMa, supplyMa, complete, headroomMa, headroomPercent, status };
}

export function partReviewRecorded(part) {
  return Boolean(part.verified && /^https?:\/\//i.test(String(part.specUrl || '')) && typeof part.checkedAt === 'string' && Number.isFinite(Date.parse(part.checkedAt)));
}

export function validate(project) {
  const issues = [];
  const ids = new Set();
  for (const p of project.parts) {
    if (!p.id || !p.name) issues.push({ kind: 'error', text: 'A part is missing its ID or name.' });
    if (ids.has(p.id)) issues.push({ kind: 'error', text: `Duplicate part ID: ${p.id}` });
    ids.add(p.id);
    if (!Number.isFinite(Number(p.qty)) || Number(p.qty) <= 0) issues.push({ kind: 'error', text: `${p.name || 'Part'} needs a positive quantity.` });
    if (!Number.isFinite(Number(p.unitCost)) || Number(p.unitCost) < 0) issues.push({ kind: 'error', text: `${p.name || 'Part'} has an invalid cost estimate.` });
    if (p.verified && !partReviewRecorded(p)) issues.push({ kind: 'error', text: `${p.name || 'Part'} is marked checked without a specification source and check date.` });
  }
  for (const w of project.wires) {
    if (!ids.has(w.from) || !ids.has(w.to)) issues.push({ kind: 'error', text: `A ${w.signal || 'wire'} connection refers to a missing part.` });
    if (w.from === w.to) issues.push({ kind: 'error', text: 'A connection points to the same part at both ends.' });
  }
  for (const link of project.mechanicalConnections || []) {
    if (!ids.has(link.from) || !ids.has(link.to)) issues.push({ kind: 'error', text: `A ${link.label || 'mechanical'} relationship refers to a missing part.` });
    if (link.from === link.to && Number(project.parts.find(part => part.id === link.from)?.qty || 0) < 2) issues.push({ kind: 'error', text: 'A mechanical relationship uses one part at both ends without multiple units.' });
    if (!String(link.label || '').trim()) issues.push({ kind: 'error', text: 'A mechanical relationship needs a mounting or fit description.' });
  }
  for (const step of project.steps) {
    for (const id of step.partIds || []) if (!ids.has(id)) issues.push({ kind: 'error', text: `Build step “${step.title || 'Untitled'}” refers to a missing part.` });
  }
  const unmappedPins = project.wires.filter(w => !String(w.fromPin || '').trim() || !String(w.toPin || '').trim()).length;
  if (unmappedPins) issues.push({ kind: 'todo', text: `${unmappedPins} connection${unmappedPins === 1 ? '' : 's'} need an exact pin or terminal at both ends.` });
  for (const rail of project.powerRails || []) {
    const name = rail.name || 'Unnamed rail';
    if (!Number.isFinite(Number(rail.voltageV)) || Number(rail.voltageV) <= 0) issues.push({ kind: 'error', text: `${name} needs a positive rail voltage.` });
    if (rail.supplyCurrentMa != null && (!Number.isFinite(Number(rail.supplyCurrentMa)) || Number(rail.supplyCurrentMa) <= 0)) issues.push({ kind: 'error', text: `${name} has an invalid supply rating.` });
    if (!Number.isFinite(Number(rail.marginPercent)) || Number(rail.marginPercent) < 0 || Number(rail.marginPercent) >= 100) issues.push({ kind: 'error', text: `${name} needs a margin target from 0 to 99%.` });
    if (rail.sourcePartId && !ids.has(rail.sourcePartId)) issues.push({ kind: 'error', text: `${name} refers to a missing supply part.` });
    const used = new Set();
    for (const load of rail.loads || []) {
      if (!ids.has(load.partId)) issues.push({ kind: 'error', text: `${name} has a load linked to a missing part.` });
      if (used.has(load.partId)) issues.push({ kind: 'error', text: `${name} counts a part twice.` });
      used.add(load.partId);
      if (load.currentMaEach != null && (!Number.isFinite(Number(load.currentMaEach)) || Number(load.currentMaEach) < 0)) issues.push({ kind: 'error', text: `${name} has an invalid load current.` });
    }
    const budget = powerBudget(project, rail);
    if (budget.status === 'incomplete') issues.push({ kind: 'todo', text: `${name} needs a supply rating and current for every assigned load.` });
    if (budget.status === 'overload') issues.push({ kind: 'error', text: `${name} exceeds its recorded supply rating by ${Math.abs(budget.headroomMa).toFixed(0)} mA.` });
    if (budget.status === 'below-margin') issues.push({ kind: 'review', text: `${name} is below its chosen ${Number(rail.marginPercent)}% headroom target.` });
  }
  if (!project.parts.length) issues.push({ kind: 'todo', text: 'Add parts before calling this a design.' });
  if (String(project.brief || '').includes('Open design questions; do not invent exact specifications:')) issues.push({ kind: 'todo', text: 'Resolve the design questions recorded in the brief before finalizing the build.' });
  if (!project.wires.length) issues.push({ kind: 'todo', text: 'Add and verify the electrical connections.' });
  if (!project.steps.length) issues.push({ kind: 'todo', text: 'Add a build and test sequence.' });
  if (project.parts.some(part => /mechanical|structural|enclosure/i.test(part.category)) && !(project.mechanicalConnections || []).length) issues.push({ kind: 'todo', text: 'Record how mechanical parts mount or fit with the rest of the build.' });
  if (project.parts.some(p => !p.verified)) issues.push({ kind: 'review', text: 'Part specifications and availability are not all verified.' });
  if (project.parts.some(p => !p.sourceUrl)) issues.push({ kind: 'review', text: 'Some parts have no verified supplier link. Costs are planning estimates.' });
  if (!project.review.electrical) issues.push({ kind: 'review', text: 'Electrical ratings, pinouts and current budget need independent review.' });
  if (!project.review.mechanical) issues.push({ kind: 'review', text: 'Dimensions, fit, material and clearances need independent review.' });
  if (!project.review.sourcing) issues.push({ kind: 'review', text: 'Supplier listings, stock, region and prices need a fresh check.' });
  return issues;
}

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function bomCsv(project) {
  return [
    ['Name', 'Category', 'Quantity', 'Unit estimate USD', 'Subtotal estimate USD', 'Supplier URL', 'Specification URL', 'Checked at', 'Verified', 'Detail'].map(csvCell).join(','),
    ...project.parts.map(p => { const unknown = Number(p.unitCost) === 0; return [p.name, p.category, p.qty, unknown ? '' : p.unitCost, unknown ? '' : (Number(p.qty) * Number(p.unitCost)).toFixed(2), p.sourceUrl, p.specUrl || '', p.checkedAt || '', partReviewRecorded(p) ? 'yes' : 'no', p.detail].map(csvCell).join(','); })
  ].join('\r\n') + '\r\n';
}

export function mountingCsv(project) {
  const names = new Map(project.parts.map(part => [part.id, part.name]));
  return [
    ['From ID', 'From part', 'To ID', 'To part', 'Mounting or fit intent', 'Notes'].map(csvCell).join(','),
    ...(project.mechanicalConnections || []).map(link => [link.from, names.get(link.from) || '', link.to, names.get(link.to) || '', link.label, link.note].map(csvCell).join(','))
  ].join('\r\n') + '\r\n';
}

export function safeProject(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.parts) || !Array.isArray(input.wires) || !Array.isArray(input.steps)) throw new Error('This file is not a Hardware Studio project.');
  if (input.parts.length > 200 || input.wires.length > 500 || input.steps.length > 200 || (input.mechanicalConnections || []).length > 500 || (input.powerRails || []).length > 20) throw new Error('This project exceeds the local editor limits.');
  if (input.mechanicalConnections != null && !Array.isArray(input.mechanicalConnections)) throw new Error('Mechanical relationships must be an array.');
  if ((input.mechanicalConnections || []).some(link => !link || typeof link !== 'object')) throw new Error('A mechanical relationship is invalid.');
  if (input.powerRails != null && !Array.isArray(input.powerRails)) throw new Error('Power rails must be an array.');
  if ((input.powerRails || []).some(rail => !rail || typeof rail !== 'object' || !Array.isArray(rail.loads) || rail.loads.length > 200)) throw new Error('A power rail has an invalid load list.');
  return {
    id: crypto.randomUUID(), title: String(input.title || 'Imported concept').slice(0, 100),
    brief: String(input.brief || '').slice(0, 5000), summary: String(input.summary || '').slice(0, 5000),
    starterId: 'imported', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    notes: String(input.notes || '').slice(0, 10000),
    tools: safeTextList(input.tools, 'Tools'), assumptions: safeTextList(input.assumptions, 'Assumptions'),
    referenceImage: safeReferenceImage(input.referenceImage),
    traySpec: input.traySpec == null ? null : validateTraySpec(input.traySpec),
    cadUrl: /^https?:\/\//i.test(String(input.cadUrl || '')) ? String(input.cadUrl).slice(0, 2000) : '',
    wiringUrl: /^https?:\/\//i.test(String(input.wiringUrl || '')) ? String(input.wiringUrl).slice(0, 2000) : '',
    parts: input.parts.map((p, i) => ({ id: String(p.id || `part-${i}`).slice(0, 80), name: String(p.name || '').slice(0, 200), category: String(p.category || 'Other').slice(0, 80), qty: Number(p.qty), unitCost: Number(p.unitCost), detail: String(p.detail || '').slice(0, 2000), voltage: String(p.voltage || '').slice(0, 60), sourceUrl: /^https?:\/\//i.test(String(p.sourceUrl || '')) ? String(p.sourceUrl).slice(0, 2000) : '', specUrl: /^https?:\/\//i.test(String(p.specUrl || '')) ? String(p.specUrl).slice(0, 2000) : '', checkedAt: '', verified: false })),
    wires: input.wires.map(w => ({ from: String(w.from || ''), fromPin: String(w.fromPin || '').slice(0, 100), to: String(w.to || ''), toPin: String(w.toPin || '').slice(0, 100), signal: String(w.signal || '').slice(0, 160), voltage: String(w.voltage || '').slice(0, 80), note: String(w.note || '').slice(0, 1000) })),
    mechanicalConnections: (input.mechanicalConnections || []).map(link => ({ from: String(link.from || '').slice(0, 80), to: String(link.to || '').slice(0, 80), label: String(link.label || '').slice(0, 240), note: String(link.note || '').slice(0, 1000) })),
    steps: input.steps.map((s, i) => ({ id: `step-${i + 1}`, phase: String(s.phase || 'Build').slice(0, 80), title: String(s.title || '').slice(0, 200), detail: String(s.detail || '').slice(0, 2000), partIds: safeStepPartIds(s.partIds), done: Boolean(s.done) })),
    powerRails: (input.powerRails || []).map((rail, i) => ({ id: String(rail.id || `rail-${i}`).slice(0, 80), name: String(rail.name || `Rail ${i + 1}`).slice(0, 100), voltageV: Number(rail.voltageV), supplyCurrentMa: rail.supplyCurrentMa == null || rail.supplyCurrentMa === '' ? null : Number(rail.supplyCurrentMa), marginPercent: Number(rail.marginPercent ?? 20), sourcePartId: String(rail.sourcePartId || '').slice(0, 80), loads: rail.loads.map(load => ({ partId: String(load.partId || '').slice(0, 80), currentMaEach: load.currentMaEach == null || load.currentMaEach === '' ? null : Number(load.currentMaEach) })) })),
    review: { electrical: false, mechanical: false, sourcing: false }
  };
}

export function restoreProjectFromRevision(currentProject, snapshot) {
  const restored = safeProject(snapshot);
  restored.id = currentProject.id;
  restored.createdAt = currentProject.createdAt;
  restored.starterId = currentProject.starterId;
  restored.steps = restored.steps.map(step => ({ ...step, done: false }));
  return restored;
}

export function localAiDraft(input, brief, model) {
  const project = safeProject(input);
  project.brief = String(brief).slice(0, 5000);
  project.starterId = 'ai';
  project.summary = 'Local AI concept draft. Proposed parts, connections, dimensions, sources and safety claims are unverified. Review the project record before use.';
  project.notes = `Generated locally with ${String(model).slice(0, 80)}. The model text below is unverified, including any measurements, source claims or assertions of testing. Check each claim against independent evidence before buying or building.\n\nMODEL NOTES / UNVERIFIED\n${project.notes}`.slice(0, 10000);
  project.cadUrl = '';
  project.wiringUrl = '';
  project.traySpec = null;
  project.parts = project.parts.map(part => ({ ...part, unitCost: 0, sourceUrl: '', specUrl: '', checkedAt: '', verified: false }));
  project.steps = project.steps.map(step => ({ ...step, done: false }));
  project.powerRails = [];
  project.review = { electrical: false, mechanical: false, sourcing: false };
  if (project.parts.length < 2 || project.wires.length < 1 || project.steps.length < 3) throw new Error('The local model returned an incomplete design record. Try a more specific brief or another model.');
  const terms = project.parts.map(part => `${part.name} ${part.category}`).join(' ').toLowerCase();
  const expected = [
    { requested: /\btemp(?:erature)?\b|thermo/i, present: /therm|temp|bme\s?280|sht\d|dht\d|ds18|tmp\d|mcp9808/i, name: 'temperature sensor' },
    { requested: /\bsoil\b|\bmoisture\b/i, present: /soil|moisture|capacitive sensor/i, name: 'soil or moisture sensor' },
    { requested: /\bdisplay\b|\bscreen\b|\boled\b/i, present: /display|screen|oled|lcd/i, name: 'display' },
    { requested: /\b(?:neopixel|ws2812)\b/i, present: /neopixel|ws2812|addressable\s+led/i, name: 'addressable LED' },
    { requested: /\bbutton\b|\bpushbutton\b/i, present: /button|switch/i, name: 'button' },
    { requested: /\bmotor\b|\bservo\b/i, present: /motor|servo/i, name: 'motor' },
    { requested: /\bled\b|\blight\b|\blamp\b/i, present: /led|light|lamp/i, name: 'light source' }
  ];
  const missing = expected.filter(check => check.requested.test(brief) && !check.present.test(terms)).map(check => check.name);
  if (missing.length) throw new Error(`The local model omitted a requested ${missing.join(' and ')}. Try another model or use a manual project.`);
  // A common model failure is a Pico-to-NeoPixel drawing with no LED supply.
  // A named 5 V design also needs a deliberate signal interface.
  if (/\b(?:pico|rp2040)\b/i.test(brief) && /\b(?:neopixel|ws2812)\b/i.test(brief)) {
    const missingHardware = [];
    const fiveVolt = /\b5\s?v\b/i.test(`${brief} ${terms}`);
    if (!/\b(?:power\s*(?:supply|source|adapter)|5\s?v\s*(?:supply|adapter)|battery|regulated\s*5\s?v)\b/i.test(terms)) missingHardware.push('rated LED power source');
    if (fiveVolt && !/\b(?:level\s*(?:shifter|converter|translator)|74(?:a)?hct(?:125|245)|logic\s*buffer)\b/i.test(terms)) missingHardware.push('logic-level interface');
    if (missingHardware.length) throw new Error(`The local model omitted a ${missingHardware.join(' and a ')} for the requested Pico and ${fiveVolt ? '5 V ' : ''}NeoPixel design. Review power and signal requirements before drafting again.`);
  }
  if (validate(project).some(issue => issue.kind === 'error')) throw new Error('The local model returned broken part references or invalid quantities. Try another model.');
  return project;
}
