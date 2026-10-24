import {validate, safeReferenceImage, bomCsv, mountingCsv, wiringCsv} from './core.js?v=43';
import {validateTraySpec} from './tray-spec.js?v=4';
import {validateSolidSpec} from './solid-spec.js?v=3';
import {validateAssemblySpec} from './assembly-spec.js?v=2';
import {createZip} from './zip.js?v=1';

const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';

// The caller captures current geometry before invoking this function and renders
// both diagrams from that same capture. No storage is read and no CAD is built.
// Export preserves recorded IDs, completion and review marks; only importing a
// package resets those marks. Validators check CAD without rewriting its source.
export function projectPackageFiles(project, {
  generatedAt = new Date().toISOString(), wiringMarkup, assemblyMarkup
} = {}) {
  if (typeof generatedAt !== 'string' || !Number.isFinite(new Date(generatedAt).getTime())) throw new Error('Use a valid package generation timestamp.');
  if (typeof wiringMarkup !== 'string' || typeof assemblyMarkup !== 'string') throw new Error('Render wiring and assembly diagrams from the captured project before packaging.');
  const p = structuredClone(project);
  if (!p || !Array.isArray(p.parts) || !Array.isArray(p.wires) || !Array.isArray(p.steps)) throw new Error('This is not a Hardware Studio project.');
  if (p.traySpec != null) validateTraySpec(p.traySpec);
  if (p.solidSpec != null) validateSolidSpec(p.solidSpec);
  if (p.assemblySpec != null) validateAssemblySpec(p.assemblySpec);
  const issues = validate(p);
  const report = `Hardware Studio review record\nGenerated: ${generatedAt}\n\nThese checks are planning prompts, not a safety, sourcing or engineering certification.\n\n${issues.length ? issues.map(issue => `[${issue.kind.toUpperCase()}] ${issue.text}`).join('\n') : 'No tracked open items in this editor. Independent verification is still required.'}\n`;
  const title = String(p.title).replace(/[\r\n]+/g, ' ');
  const reference = safeReferenceImage(p.referenceImage);
  const traySpec = p.traySpec;
  const solidSpec = p.solidSpec;
  const assemblySpec = p.assemblySpec;
  const partNames = new Map(p.parts.map(part => [part.id, part.name]));
  const buildPlan = `${title}\nBuild plan exported ${generatedAt}\n\nTOOLS AND CONSUMABLES\n${(p.tools || []).length ? p.tools.map(tool => `- ${tool}`).join('\n') : '(not recorded)'}\n\nASSUMPTIONS AND PREREQUISITES\n${(p.assumptions || []).length ? p.assumptions.map(item => `- ${item}`).join('\n') : '(not recorded)'}\n\nSTEPS\n${p.steps.map((step, index) => `${index + 1}. [${step.phase}] ${step.title}${step.done ? ' (checked in this browser)' : ''}\n   ${step.detail}\n   Parts: ${(step.partIds || []).map(id => partNames.get(id) || `Missing: ${id}`).join(', ') || '(not linked)'}`).join('\n\n')}\n\nThis is a planning record, not a verified build procedure.\n`;
  const readme = `# ${title}\n\nExported from Hardware Studio on ${generatedAt}.\n\n- [Project data](project.json): edit or re-import this JSON. Imported verification marks reset.\n- [Parts list](bill-of-materials.csv): planning estimates; blank costs mean unknown.\n- [Build plan](build-plan.txt): tools, assumptions and part-linked checklist; verify each operation.\n- [Mounting notes](mounting.csv): proposed mechanical relationships, not verified fit.\n- [Connection register](connections.csv): each recorded relationship and its pin-name review state; rows may still combine conductors.\n- [Wiring map](wiring.svg): conceptual relationships, not a verified schematic.\n- [Assembly index](assembly.svg): conceptual part inventory, not dimensioned CAD.\n- [Open checks](review.txt): current editor findings.${traySpec ? '\n- [Tray CAD input](tray-spec.json): editable millimeter spec for the local generator; physical fit unverified.' : ''}${solidSpec ? '\n- [Feature CAD input](solid-spec.json): ordered editable shared source; generate checked STEP/STL separately in the solid modeler.' : ''}${assemblySpec ? '\n- [Placed CAD input](assembly-spec.json): per-part sources and explicit instances, also exported in cad-sources/part-001.json order. Generate a checked assembly STEP/STL ZIP separately; this source export contains no physical verification.' : ''}${reference ? '\n- [Visual reference](reference.jpg): resized local sketch or photo; visual interpretation is unverified.' : ''}${reference?.sketch ? '\n- [Editable sketch](reference-sketch.json): original bounded strokes and labels, also retained in project.json; annotations are not measured specifications.' : ''}\n\nExternal evidence links remain URLs in project.json; their contents are not copied into this package.${safeUrl(p.wiringUrl) ? `\nElectrical plan: ${p.wiringUrl}` : ''}${safeUrl(p.cadUrl) ? `\nCAD package: ${p.cadUrl}` : ''}\n\nCheck exact parts, pinouts, power, fit and supplier listings before buying or building.\n`;
  const standaloneSvg = markup => markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return [
    { name: 'README.md', data: readme },
    { name: 'project.json', data: JSON.stringify(p, null, 2) + '\n' },
    { name: 'bill-of-materials.csv', data: bomCsv(p) },
    { name: 'connections.csv', data: wiringCsv(p) },
    { name: 'build-plan.txt', data: buildPlan },
    { name: 'mounting.csv', data: mountingCsv(p) },
    { name: 'wiring.svg', data: standaloneSvg(wiringMarkup) },
    { name: 'assembly.svg', data: standaloneSvg(assemblyMarkup) },
    { name: 'review.txt', data: report },
    ...(traySpec ? [{ name: 'tray-spec.json', data: JSON.stringify(traySpec, null, 2) + '\n' }] : []),
    ...(solidSpec ? [{ name: 'solid-spec.json', data: JSON.stringify(solidSpec, null, 2) + '\n' }] : []),
    ...(assemblySpec ? [{name:'assembly-spec.json',data:JSON.stringify(assemblySpec,null,2)+'\n'},...assemblySpec.assets.map((asset,index)=>({name:'cad-sources/part-'+String(index+1).padStart(3,'0')+'.json',data:JSON.stringify(asset.source,null,2)+'\n'}))] : []),
    ...(reference ? [{ name: 'reference.jpg', data: Uint8Array.from(atob(reference.dataUrl.split(',')[1]), char => char.charCodeAt(0)) }] : []),
    ...(reference?.sketch ? [{ name: 'reference-sketch.json', data: JSON.stringify(reference.sketch,null,2) }] : [])
  ];
}

export function projectSourceArchive(project, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return createZip(projectPackageFiles(project, {...options, generatedAt}), new Date(generatedAt));
}
