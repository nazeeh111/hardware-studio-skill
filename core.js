export const STORAGE_KEY = 'hardware-studio-projects-v1';

const part = (id, name, category, qty, unitCost, detail, voltage = '') => ({
  id, name, category, qty, unitCost, detail, voltage, sourceUrl: '', verified: false
});

export const STARTERS = [
  {
    id: 'plant', name: 'Desk plant monitor', icon: '◌', tag: 'SENSING',
    prompt: 'A USB powered desk plant monitor with temperature, humidity, soil moisture and a small display.',
    summary: 'An ESP32 reads the room and soil, then shows the measurements on an I²C display. This is a concept design; choose exact modules and verify every pin and rating before wiring.',
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
      { phase: 'Prepare', title: 'Confirm exact modules', detail: 'Record datasheets, dimensions, connector orientation and voltage range for each purchased part.' },
      { phase: 'Prepare', title: 'Plan enclosure openings', detail: 'Leave access for USB and airflow to the BME280; protect the controller from wet soil.' },
      { phase: 'Wire', title: 'Connect the I²C bus', detail: 'With power disconnected, connect common ground, 3.3 V, SDA and SCL using verified module pinouts.' },
      { phase: 'Wire', title: 'Connect the soil sensor', detail: 'Confirm its output is within the ADC input range, then connect to ADC1 GPIO34 and ground.' },
      { phase: 'Bring up', title: 'Test one device at a time', detail: 'Power from USB, scan I²C addresses, compare room readings with a reference and calibrate soil readings in dry and wet conditions.' },
      { phase: 'Assemble', title: 'Fit and strain-relieve', detail: 'Mount components, route cables away from water and check that no connector is under tension.' }
    ]
  },
  {
    id: 'light', name: 'USB ambient light', icon: '✳', tag: 'LIGHTING',
    prompt: 'A USB powered ambient desk light with a button and individually addressable LEDs.',
    summary: 'An ESP32 controls a short 5 V LED strip through a level shifter. The wiring and power budget need checks against the exact strip, board and supply.',
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
    steps: [
      { phase: 'Prepare', title: 'Calculate power demand', detail: 'Use the chosen strip datasheet to compute maximum current. Compare with supply, cable and connector ratings.' },
      { phase: 'Prepare', title: 'Measure the fit', detail: 'Measure strip width, bend radius, board size and connector clearance before making the enclosure.' },
      { phase: 'Wire', title: 'Build the data path', detail: 'With power disconnected, wire GPIO to level shifter, series resistor and strip DIN. Tie grounds together.' },
      { phase: 'Wire', title: 'Connect power', detail: 'Wire the strip directly to a suitable 5 V supply and the controller through its USB connector. Add the polarized input capacitor.' },
      { phase: 'Bring up', title: 'Test at low brightness', detail: 'Start with a few LEDs and a current limit. Confirm data direction and measure supply voltage at the far end.' },
      { phase: 'Assemble', title: 'Check heat and strain relief', detail: 'Run at expected brightness, inspect temperature and secure the cable entry.' }
    ]
  }
];

export function makeProject(starter, title) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: title || starter.name, brief: starter.prompt,
    summary: starter.summary, starterId: starter.id, createdAt: now, updatedAt: now,
    parts: structuredClone(starter.parts), wires: structuredClone(starter.wires),
    steps: structuredClone(starter.steps).map((step, i) => ({ ...step, id: `step-${i + 1}`, done: false })),
    notes: '', review: { electrical: false, mechanical: false, sourcing: false }
  };
}

export function blankProject(title = 'Untitled concept') {
  return {
    id: crypto.randomUUID(), title, brief: '', summary: 'Describe the intended function, constraints and operating environment.',
    starterId: 'blank', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    parts: [], wires: [], steps: [], notes: '',
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

export function validate(project) {
  const issues = [];
  const ids = new Set();
  for (const p of project.parts) {
    if (!p.id || !p.name) issues.push({ kind: 'error', text: 'A part is missing its ID or name.' });
    if (ids.has(p.id)) issues.push({ kind: 'error', text: `Duplicate part ID: ${p.id}` });
    ids.add(p.id);
    if (!Number.isFinite(Number(p.qty)) || Number(p.qty) <= 0) issues.push({ kind: 'error', text: `${p.name || 'Part'} needs a positive quantity.` });
    if (!Number.isFinite(Number(p.unitCost)) || Number(p.unitCost) < 0) issues.push({ kind: 'error', text: `${p.name || 'Part'} has an invalid cost estimate.` });
  }
  for (const w of project.wires) {
    if (!ids.has(w.from) || !ids.has(w.to)) issues.push({ kind: 'error', text: `A ${w.signal || 'wire'} connection refers to a missing part.` });
    if (w.from === w.to) issues.push({ kind: 'error', text: 'A connection points to the same part at both ends.' });
  }
  if (!project.parts.length) issues.push({ kind: 'todo', text: 'Add parts before calling this a design.' });
  if (!project.wires.length) issues.push({ kind: 'todo', text: 'Add and verify the electrical connections.' });
  if (!project.steps.length) issues.push({ kind: 'todo', text: 'Add a build and test sequence.' });
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
    ['Name', 'Category', 'Quantity', 'Unit estimate USD', 'Subtotal estimate USD', 'Source URL', 'Verified', 'Detail'].map(csvCell).join(','),
    ...project.parts.map(p => [p.name, p.category, p.qty, p.unitCost, (Number(p.qty) * Number(p.unitCost)).toFixed(2), p.sourceUrl, p.verified ? 'yes' : 'no', p.detail].map(csvCell).join(','))
  ].join('\r\n') + '\r\n';
}

export function safeProject(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.parts) || !Array.isArray(input.wires) || !Array.isArray(input.steps)) throw new Error('This file is not a Hardware Studio project.');
  if (input.parts.length > 200 || input.wires.length > 500 || input.steps.length > 200) throw new Error('This project exceeds the local editor limits.');
  return {
    id: crypto.randomUUID(), title: String(input.title || 'Imported concept').slice(0, 100),
    brief: String(input.brief || '').slice(0, 5000), summary: String(input.summary || '').slice(0, 5000),
    starterId: String(input.starterId || 'imported'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    notes: String(input.notes || '').slice(0, 10000),
    parts: input.parts.map((p, i) => ({ id: String(p.id || `part-${i}`).slice(0, 80), name: String(p.name || '').slice(0, 200), category: String(p.category || 'Other').slice(0, 80), qty: Number(p.qty), unitCost: Number(p.unitCost), detail: String(p.detail || '').slice(0, 2000), voltage: String(p.voltage || '').slice(0, 60), sourceUrl: /^https?:\/\//i.test(String(p.sourceUrl || '')) ? String(p.sourceUrl).slice(0, 2000) : '', verified: Boolean(p.verified) })),
    wires: input.wires.map(w => ({ from: String(w.from || ''), to: String(w.to || ''), signal: String(w.signal || '').slice(0, 160), voltage: String(w.voltage || '').slice(0, 80), note: String(w.note || '').slice(0, 1000) })),
    steps: input.steps.map((s, i) => ({ id: `step-${i + 1}`, phase: String(s.phase || 'Build').slice(0, 80), title: String(s.title || '').slice(0, 200), detail: String(s.detail || '').slice(0, 2000), done: Boolean(s.done) })),
    review: { electrical: false, mechanical: false, sourcing: false }
  };
}
