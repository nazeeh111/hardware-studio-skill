"""Generate a dimensioned, editable tray study from an explicit JSON spec.

Only the tray is modeled. Component envelopes, tolerances, connectors, and
physical fit must be checked separately before fabrication.
"""

import argparse
import hashlib
import html
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt


def number(value, label, lower=0, upper=500):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower < value <= upper:
        raise ValueError(f'{label} must be finite and above {lower} to {upper} mm')
    return float(value)


def validate(spec):
    if not isinstance(spec, dict) or spec.get('schema') != 'hardware-studio-tray-v1' or spec.get('units') != 'mm':
        raise ValueError('Expected hardware-studio-tray-v1 with millimeter units')
    outer = spec.get('outer')
    if not isinstance(outer, dict):
        raise ValueError('outer dimensions are required')
    length = number(outer.get('length'), 'outer.length')
    width = number(outer.get('width'), 'outer.width')
    height = number(outer.get('height'), 'outer.height')
    wall = number(spec.get('wall'), 'wall', upper=20)
    floor = number(spec.get('floor'), 'floor', upper=20)
    if length <= 2 * wall + 2 or width <= 2 * wall + 2 or height <= floor + 1:
        raise ValueError('Walls or floor consume the usable cavity')
    mounts = spec.get('mounts', [])
    cutouts = spec.get('cutouts', [])
    if not isinstance(mounts, list) or len(mounts) > 100 or not isinstance(cutouts, list) or len(cutouts) > 20:
        raise ValueError('mounts and cutouts must be bounded arrays')
    ids = set()
    normalized_mounts = []
    for index, mount in enumerate(mounts):
        if not isinstance(mount, dict) or not isinstance(mount.get('id'), str) or not mount['id'] or len(mount['id']) > 80 or mount['id'] in ids:
            raise ValueError(f'mounts[{index}] needs a unique short ID')
        ids.add(mount['id'])
        x = number(mount.get('x'), f'mounts[{index}].x')
        y = number(mount.get('y'), f'mounts[{index}].y')
        radius = number(mount.get('bossRadius'), f'mounts[{index}].bossRadius', upper=40)
        top = number(mount.get('bossTopZ'), f'mounts[{index}].bossTopZ')
        if top <= floor or top >= height:
            raise ValueError(f'mounts[{index}] boss top must lie between floor and rim')
        if not (wall + radius < x < length - wall - radius and wall + radius < y < width - wall - radius):
            raise ValueError(f'mounts[{index}] boss intersects a wall or falls outside the cavity')
        has_pin = mount.get('locatorRadius') is not None or mount.get('locatorHeight') is not None
        has_hole = mount.get('holeRadius') is not None
        if has_pin and has_hole:
            raise ValueError(f'mounts[{index}] cannot have both a locator and a through-hole')
        pin_radius = pin_height = hole_radius = None
        if has_pin:
            pin_radius = number(mount.get('locatorRadius'), f'mounts[{index}].locatorRadius', upper=20)
            pin_height = number(mount.get('locatorHeight'), f'mounts[{index}].locatorHeight', upper=20)
            if pin_radius >= radius - .5 or top + pin_height >= height:
                raise ValueError(f'mounts[{index}] locator is too wide or too tall')
        if has_hole:
            hole_radius = number(mount.get('holeRadius'), f'mounts[{index}].holeRadius', upper=20)
            if hole_radius >= radius - .8:
                raise ValueError(f'mounts[{index}] through-hole leaves too little boss wall')
        normalized_mounts.append(dict(id=mount['id'], x=x, y=y, bossRadius=radius, bossTopZ=top, locatorRadius=pin_radius, locatorHeight=pin_height, holeRadius=hole_radius))
    for index, first in enumerate(normalized_mounts):
        for second in normalized_mounts[index + 1:]:
            if math.hypot(first['x'] - second['x'], first['y'] - second['y']) <= first['bossRadius'] + second['bossRadius'] + .1:
                raise ValueError(f"Bosses {first['id']} and {second['id']} overlap")
    normalized_cutouts = []
    for index, cutout in enumerate(cutouts):
        if not isinstance(cutout, dict) or cutout.get('edge') not in ('left', 'right', 'front', 'back'):
            raise ValueError(f'cutouts[{index}] needs left, right, front or back edge')
        edge = cutout['edge']
        edge_span = width if edge in ('left', 'right') else length
        start = number(cutout.get('start'), f'cutouts[{index}].start', lower=-1, upper=edge_span)
        end = number(cutout.get('end'), f'cutouts[{index}].end', upper=edge_span)
        bottom = number(cutout.get('bottom'), f'cutouts[{index}].bottom', upper=height)
        top = number(cutout.get('top'), f'cutouts[{index}].top', upper=height)
        if start < wall or end > edge_span - wall or start >= end or bottom < floor or bottom >= top:
            raise ValueError(f'cutouts[{index}] must stay between corners and above the floor')
        normalized_cutouts.append(dict(edge=edge, start=start, end=end, bottom=bottom, top=top))
    return dict(title=str(spec.get('title') or 'Tray study')[:100], outer=dict(length=length, width=width, height=height), wall=wall, floor=floor, mounts=normalized_mounts, cutouts=normalized_cutouts)


def box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def cylinder(x, y, z, radius, height):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1)), radius, height).Shape()


def boolean(operation, first, second):
    result = operation(first, second)
    result.Build()
    if not result.IsDone() or not BRepCheck_Analyzer(result.Shape()).IsValid():
        raise RuntimeError(f'OpenCascade {operation.__name__} failed or produced invalid geometry')
    return result.Shape()


def make_tray(spec):
    outer, wall, floor = spec['outer'], spec['wall'], spec['floor']
    length, width, height = outer['length'], outer['width'], outer['height']
    tray = box(0, 0, 0, length, width, height)
    tray = boolean(BRepAlgoAPI_Cut, tray, box(wall, wall, floor, length - 2 * wall, width - 2 * wall, height - floor + 1))
    for cutout in spec['cutouts']:
        edge, start, end, bottom, top = (cutout[key] for key in ('edge', 'start', 'end', 'bottom', 'top'))
        top_span = top - bottom + (1 if top == height else 0)
        if edge == 'left': cutter = box(-1, start, bottom, wall + 2, end - start, top_span)
        elif edge == 'right': cutter = box(length - wall - 1, start, bottom, wall + 2, end - start, top_span)
        elif edge == 'front': cutter = box(start, -1, bottom, end - start, wall + 2, top_span)
        else: cutter = box(start, width - wall - 1, bottom, end - start, wall + 2, top_span)
        tray = boolean(BRepAlgoAPI_Cut, tray, cutter)
    for mount in spec['mounts']:
        x, y, radius, top = (mount[key] for key in ('x', 'y', 'bossRadius', 'bossTopZ'))
        tray = boolean(BRepAlgoAPI_Fuse, tray, cylinder(x, y, floor - .1, radius, top - floor + .1))
        if mount['locatorRadius'] is not None:
            tray = boolean(BRepAlgoAPI_Fuse, tray, cylinder(x, y, top - .1, mount['locatorRadius'], mount['locatorHeight'] + .1))
        if mount['holeRadius'] is not None:
            tray = boolean(BRepAlgoAPI_Cut, tray, cylinder(x, y, -1, mount['holeRadius'], top + 2))
    if not BRepCheck_Analyzer(tray).IsValid():
        raise RuntimeError('Finished tray is invalid')
    return tray


def bounds(shape):
    boundary = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, boundary, False, False)
    lo, hi = boundary.CornerMin(), boundary.CornerMax()
    return [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()]


def volume(shape):
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties)
    return properties.Mass()


def layout_svg(spec):
    length, width = spec['outer']['length'], spec['outer']['width']
    scale = min(8, 640 / max(length, width))
    x0 = y0 = 72
    w, h = length * scale, width * scale
    wall = spec['wall'] * scale
    mounts = ''.join(f'<g><circle cx="{x0 + m["x"] * scale:.2f}" cy="{y0 + m["y"] * scale:.2f}" r="{m["bossRadius"] * scale:.2f}" fill="none" stroke="#728d69" stroke-width="2"/><circle cx="{x0 + m["x"] * scale:.2f}" cy="{y0 + m["y"] * scale:.2f}" r="3" fill="#728d69"/><text x="{x0 + (m["x"] + m["bossRadius"]) * scale + 6:.2f}" y="{y0 + m["y"] * scale - 5:.2f}" font-size="10" fill="#233d31">{html.escape(m["id"])}</text></g>' for m in spec['mounts'])
    cutouts = ''
    for cut in spec['cutouts']:
        a, b = cut['start'] * scale, cut['end'] * scale
        if cut['edge'] == 'left': x1, y1, cw, ch = x0 - 1, y0 + a, wall + 2, b - a
        elif cut['edge'] == 'right': x1, y1, cw, ch = x0 + w - wall - 1, y0 + a, wall + 2, b - a
        elif cut['edge'] == 'front': x1, y1, cw, ch = x0 + a, y0 - 1, b - a, wall + 2
        else: x1, y1, cw, ch = x0 + a, y0 + h - wall - 1, b - a, wall + 2
        cutouts += f'<rect x="{x1:.2f}" y="{y1:.2f}" width="{cw:.2f}" height="{ch:.2f}" fill="#f4f5ef" stroke="#b26c4a" stroke-width="1"/>'
    title = html.escape(spec['title'])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w + 144:.2f} {h + 150:.2f}" role="img" aria-label="Dimensioned tray top view">
<rect width="100%" height="100%" fill="#f4f5ef"/><text x="72" y="30" font-family="sans-serif" font-size="15" font-weight="bold" fill="#183026">{title}</text>
<text x="72" y="47" font-family="monospace" font-size="9" fill="#6c806f">TOP VIEW / MILLIMETERS / PROTOTYPE GEOMETRY</text>
<rect x="{x0}" y="{y0}" width="{w:.2f}" height="{h:.2f}" fill="#dbe6d1" stroke="#183026" stroke-width="2"/>
<rect x="{x0 + wall:.2f}" y="{y0 + wall:.2f}" width="{w - 2 * wall:.2f}" height="{h - 2 * wall:.2f}" fill="#f4f5ef" stroke="#819781" stroke-width="1"/>
{cutouts}{mounts}
<path d="M{x0} {y0 + h + 20}H{x0 + w}M{x0} {y0 + h + 15}v10M{x0 + w} {y0 + h + 15}v10" stroke="#233d31"/>
<text x="{x0 + w / 2:.2f}" y="{y0 + h + 37:.2f}" font-family="monospace" font-size="11" text-anchor="middle" fill="#233d31">{length:g} mm</text>
<path d="M{x0 - 20} {y0}V{y0 + h}M{x0 - 25} {y0}h10M{x0 - 25} {y0 + h}h10" stroke="#233d31"/>
<text x="{x0 - 29}" y="{y0 + h / 2:.2f}" transform="rotate(-90 {x0 - 29} {y0 + h / 2:.2f})" font-family="monospace" font-size="11" text-anchor="middle" fill="#233d31">{width:g} mm</text>
<text x="72" y="{h + 135:.2f}" font-family="monospace" font-size="9" fill="#6c806f">OUTER HEIGHT {spec['outer']['height']:g} · WALL {spec['wall']:g} · FLOOR {spec['floor']:g} · PHYSICAL FIT UNTESTED</text>
</svg>'''


def export(shape, output):
    writer = STEPControl_Writer()
    Interface_Static.SetCVal_s('write.step.unit', 'MM')
    if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone or writer.Write(str(output / 'tray.step')) != IFSelect_RetDone:
        raise RuntimeError('STEP export failed')
    mesher = BRepMesh_IncrementalMesh(shape, .04, False, .15, False)
    mesher.Perform()
    stl = StlAPI_Writer()
    stl.ASCIIMode = False
    if not stl.Write(shape, str(output / 'tray.stl')):
        raise RuntimeError('STL export failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True, help='An absent output directory whose parent exists')
    args = parser.parse_args()
    destination = args.out.expanduser().resolve()
    if destination.exists() or not destination.parent.is_dir():
        parser.error('--out must be absent and its parent must exist')
    raw = args.spec.expanduser().resolve().read_bytes()
    spec = validate(json.loads(raw))
    shape = make_tray(spec)
    staging = Path(tempfile.mkdtemp(prefix='.tray-staging-', dir=destination.parent))
    try:
        (staging / 'spec.json').write_text(json.dumps({'schema': 'hardware-studio-tray-v1', 'units': 'mm', **spec}, indent=2) + '\n')
        (staging / 'layout.svg').write_text(layout_svg(spec))
        export(shape, staging)
        report = {'status': 'kernel-valid; physical fit untested', 'units': 'mm', 'source_spec_sha256': hashlib.sha256(raw).hexdigest(), 'outer_span_mm': bounds(shape), 'volume_mm3': volume(shape), 'mount_count': len(spec['mounts']), 'cutout_count': len(spec['cutouts']), 'solid_valid': BRepCheck_Analyzer(shape).IsValid(), 'vendor_models_included': False}
        (staging / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
        subprocess.run([sys.executable, str(Path(__file__).with_name('verify.py')), '--package', str(staging)], check=True, capture_output=True, text=True)
        staging.rename(destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(json.dumps({'output': str(destination), 'report': report}, indent=2))


if __name__ == '__main__':
    main()
