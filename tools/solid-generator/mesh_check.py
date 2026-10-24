"""Bounded binary STL checks against a reopened analytic STEP boundary.

Every triangle center is tested against trimmed STEP faces, never the solid's
interior. This is a sampled surface check, not a Hausdorff-distance proof.
"""
import hashlib
import math
import os
from pathlib import Path
import struct
import tempfile
import time

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepTools import BRepTools
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_FACE, TopAbs_SHELL, TopAbs_VERTEX, TopAbs_IN, TopAbs_ON
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.gp import gp_Pnt, gp_Pnt2d

MAX_TRIANGLES = 400_000
# Includes bounded source origins/arc extents under rigid assembly placements.
MAX_COORDINATE_MM = 4000
WELD_MM = .0002
MESH_DEFLECTION_MM = .04
NUMERIC_ALLOWANCE_MM = .0005
CENTER_TOLERANCE_MM = MESH_DEFLECTION_MM + NUMERIC_ALLOWANCE_MM


def _sub(a, b): return tuple(a[i] - b[i] for i in range(3))
def _cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def _dot(a, b): return sum(a[i]*b[i] for i in range(3))



def normalize_export_mesh(path, raw_path):
    """Normalize only numerically zero-area facets in a trusted derived export.

    Caller supplies the controlled sibling *.raw.stl path, includes it in the
    package if created, and strictly verifies the final mesh afterwards. This
    does not repair topology, remove nonzero facets, or sanitize user imports.
    """
    path, raw_path = Path(path), Path(raw_path)
    if path.is_symlink() or not path.is_file() or raw_path.parent.resolve() != path.parent.resolve() or not raw_path.name.endswith('.raw.stl') or raw_path == path:
        raise ValueError('Export normalization needs a regular mesh and a controlled sibling .raw.stl path.')
    if raw_path.exists() or raw_path.is_symlink():
        raise ValueError('Raw STL preservation path already exists; it will not be replaced.')
    if not 284 <= path.stat().st_size <= 84 + MAX_TRIANGLES*50:
        raise ValueError('STL size is outside the bounded binary mesh limit.')
    data = path.read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    if not 4 <= count <= MAX_TRIANGLES or len(data) != 84 + count*50:
        raise ValueError('STL binary triangle count or byte length is invalid.')
    kept, removed = [], 0
    for index in range(count):
        record = data[84+index*50:134+index*50]
        values = struct.unpack_from('<12f', record)
        if not all(math.isfinite(value) for value in values):
            raise ValueError('Non-finite STL values cannot be normalized.')
        points = [tuple(values[3+3*j:6+3*j]) for j in range(3)]
        if any(abs(value) > MAX_COORDINATE_MM for point in points for value in point):
            raise ValueError('STL coordinates exceed the bounded CAD comparison range.')
        cross = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
        if _dot(cross, cross) <= 1e-24:
            removed += 1
        else:
            kept.append(record)
    if len(kept) < 4:
        raise ValueError('Zero-area facet removal would leave no closed mesh; raw export was not changed.')
    final = data if not removed else data[:80]+struct.pack('<I', len(kept))+b''.join(kept)
    raw_hash, final_hash = hashlib.sha256(data).hexdigest(), hashlib.sha256(final).hexdigest()
    if removed:
        with raw_path.open('xb') as backup:
            backup.write(data)
            backup.flush()
            os.fsync(backup.fileno())
        if hashlib.sha256(raw_path.read_bytes()).hexdigest() != raw_hash:
            raise ValueError('Raw STL byte preservation could not be verified; final mesh was not replaced.')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix='.mesh-normalized-', dir=path.parent, delete=False) as output:
                temporary = Path(output.name)
                output.write(final)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
            temporary = None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return {'changed': bool(removed), 'source_triangles': count, 'final_triangles': len(kept),
            'removed_zero_area_facets': removed, 'maximum_removed_area_mm2': 5e-13,
            'criterion': 'Squared cross-product length <= 1e-24 mm4; no nonzero-area topology repair or weld-collapse filtering.',
            'raw_sha256': raw_hash, 'final_sha256': final_hash,
            'raw_file': raw_path.name if removed else None,
            'limit': 'Normalization alone does not establish valid topology or source fidelity. The final mesh must pass strict STEP comparison.'}


def verify_export_mesh_record(path, record):
    """Read-only replay of a trusted export's normalization receipt.

    The receipt does not authorize arbitrary file reads. A changed export may
    reference only the canonical same-directory ``<stem>.raw.stl`` sibling.
    Hashes, counts and bytes are verified; no mesh or report is changed.
    """
    fields = {'changed', 'source_triangles', 'final_triangles', 'removed_zero_area_facets',
              'maximum_removed_area_mm2', 'criterion', 'raw_sha256', 'final_sha256',
              'raw_file', 'limit'}
    criterion = 'Squared cross-product length <= 1e-24 mm4; no nonzero-area topology repair or weld-collapse filtering.'
    limit = 'Normalization alone does not establish valid topology or source fidelity. The final mesh must pass strict STEP comparison.'
    if not isinstance(record, dict) or set(record) != fields or type(record['changed']) is not bool:
        raise ValueError('STL export record has unsupported or missing fields.')
    for key in ('source_triangles', 'final_triangles', 'removed_zero_area_facets'):
        if type(record[key]) is not int or not 0 <= record[key] <= MAX_TRIANGLES:
            raise ValueError('STL export record triangle counts must be bounded integers.')
    if not 4 <= record['source_triangles'] <= MAX_TRIANGLES or not 4 <= record['final_triangles'] <= MAX_TRIANGLES or record['source_triangles']-record['final_triangles'] != record['removed_zero_area_facets']:
        raise ValueError('STL export record triangle counts disagree.')
    if type(record['maximum_removed_area_mm2']) not in (int, float) or record['maximum_removed_area_mm2'] != 5e-13 or record['criterion'] != criterion or record['limit'] != limit:
        raise ValueError('STL export record does not use the fixed zero-area normalization policy.')
    for key in ('raw_sha256', 'final_sha256'):
        value = record[key]
        if not isinstance(value, str) or len(value) != 64 or any(char not in '0123456789abcdef' for char in value):
            raise ValueError('STL export record needs lowercase SHA256 hashes.')
    if record['changed'] != (record['removed_zero_area_facets'] > 0):
        raise ValueError('STL export record change flag disagrees with its removed count.')
    path = Path(path)
    raw_path = path.with_suffix('.raw.stl')
    if path.suffix != '.stl' or path.is_symlink() or not path.is_file():
        raise ValueError('STL export verification needs a regular final .stl file.')
    if record['changed']:
        if record['raw_file'] != raw_path.name:
            raise ValueError('STL export record must reference its controlled canonical .raw.stl sibling.')
        if raw_path.is_symlink() or not raw_path.is_file():
            raise ValueError('Preserved raw STL is missing or is not a regular file.')
    elif record['raw_file'] is not None or raw_path.exists() or raw_path.is_symlink():
        raise ValueError('An unchanged STL export must not reference or leave an unreported raw sibling.')

    def read_bounded(mesh):
        try:
            if not 284 <= mesh.stat().st_size <= 84+MAX_TRIANGLES*50:
                raise ValueError('STL export bytes exceed the bounded binary mesh limits.')
            data = mesh.read_bytes()
        except OSError as error:
            raise ValueError('STL export bytes could not be read for receipt verification.') from error
        count = struct.unpack_from('<I', data, 80)[0]
        if not 4 <= count <= MAX_TRIANGLES or len(data) != 84+count*50:
            raise ValueError('STL export binary triangle count or length is invalid.')
        return data, count

    final, final_count = read_bounded(path)
    if final_count != record['final_triangles'] or hashlib.sha256(final).hexdigest() != record['final_sha256']:
        raise ValueError('Final STL bytes or triangle count differ from the export record.')
    raw, raw_count = read_bounded(raw_path) if record['changed'] else (final, final_count)
    if raw_count != record['source_triangles'] or hashlib.sha256(raw).hexdigest() != record['raw_sha256']:
        raise ValueError('Preserved raw STL bytes or triangle count differ from the export record.')
    kept, removed = [], 0
    for index in range(raw_count):
        facet = raw[84+index*50:134+index*50]
        values = struct.unpack_from('<12f', facet)
        if not all(math.isfinite(value) for value in values):
            raise ValueError('Raw STL export contains non-finite values.')
        points = [tuple(values[3+3*j:6+3*j]) for j in range(3)]
        if any(abs(value) > MAX_COORDINATE_MM for point in points for value in point):
            raise ValueError('Raw STL export coordinates exceed the bounded comparison range.')
        cross = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
        if _dot(cross, cross) <= 1e-24:
            removed += 1
        else:
            kept.append(facet)
    replayed = raw if not removed else raw[:80]+struct.pack('<I', len(kept))+b''.join(kept)
    if removed != record['removed_zero_area_facets'] or len(kept) != final_count or replayed != final:
        raise ValueError('Final STL is not the exact zero-area-only removal replay of its preserved raw export.')
    return {'passed': True, 'changed': record['changed'], 'source_triangles': raw_count,
            'final_triangles': final_count, 'replayed_zero_area_removals': removed,
            'maximum_removed_area_mm2': 5e-13, 'raw_file': record['raw_file'],
            'raw_sha256': record['raw_sha256'], 'final_sha256': record['final_sha256'],
            'exact_byte_replay': True}

def _boundary(shape):
    builder, boundary = BRep_Builder(), TopoDS_Compound()
    builder.MakeCompound(boundary)
    explorer, count = TopExp_Explorer(shape, TopAbs_FACE), 0
    while explorer.More():
        builder.Add(boundary, explorer.Current())
        count += 1
        explorer.Next()
    if not count:
        raise ValueError('STEP has no trimmed boundary faces for STL comparison.')
    return boundary



def _point_triangle_distance2(point, triangle):
    # Closest point on a nondegenerate triangle, including its edges/vertices.
    a, b, c = triangle
    ab, ac, ap = _sub(b, a), _sub(c, a), _sub(point, a)
    d1, d2 = _dot(ab, ap), _dot(ac, ap)
    if d1 <= 0 and d2 <= 0: return _dot(ap, ap)
    bp = _sub(point, b)
    d3, d4 = _dot(ab, bp), _dot(ac, bp)
    if d3 >= 0 and d4 <= d3: return _dot(bp, bp)
    vc = d1*d4-d3*d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1/(d1-d3)
        delta = _sub(point, tuple(a[k]+v*ab[k] for k in range(3)))
        return _dot(delta, delta)
    cp = _sub(point, c)
    d5, d6 = _dot(ab, cp), _dot(ac, cp)
    if d6 >= 0 and d5 <= d6: return _dot(cp, cp)
    vb = d5*d2-d1*d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2/(d2-d6)
        delta = _sub(point, tuple(a[k]+w*ac[k] for k in range(3)))
        return _dot(delta, delta)
    va = d3*d6-d5*d4
    if va <= 0 and d4-d3 >= 0 and d5-d6 >= 0:
        w = (d4-d3)/((d4-d3)+(d5-d6))
        delta = _sub(point, tuple(b[k]+w*(c[k]-b[k]) for k in range(3)))
        return _dot(delta, delta)
    normal = _cross(ab, ac)
    return _dot(ap, normal)**2/_dot(normal, normal)


def _triangle_tree(triangles, indices, deadline):
    deadline()
    low = tuple(min(triangles[i][j][k] for i in indices for j in range(3)) for k in range(3))
    high = tuple(max(triangles[i][j][k] for i in indices for j in range(3)) for k in range(3))
    if len(indices) <= 16:
        return (low, high, indices, None, None)
    axis = max(range(3), key=lambda k: high[k]-low[k])
    indices.sort(key=lambda i: sum(point[axis] for point in triangles[i]))
    middle = len(indices)//2
    return (low, high, None, _triangle_tree(triangles, indices[:middle], deadline), _triangle_tree(triangles, indices[middle:], deadline))


def _mesh_distance(point, tree, triangles):
    def bound(node):
        return sum(max(node[0][k]-point[k], 0, point[k]-node[1][k])**2 for k in range(3))
    best, pending = math.inf, [(0, tree)]
    while pending:
        distance, node = pending.pop()
        if distance > best: continue
        if node[2] is not None:
            for index in node[2]:
                best = min(best, _point_triangle_distance2(point, triangles[index]))
        else:
            children = sorted([(bound(node[3]), node[3]), (bound(node[4]), node[4])], key=lambda item: item[0], reverse=True)
            pending.extend(children)
    return math.sqrt(max(0, best))


def _face_witnesses(shape):
    explorer, index = TopExp_Explorer(shape, TopAbs_FACE), 0
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        bounds = BRepTools.UVBounds_s(face)
        if not all(math.isfinite(value) for value in bounds):
            raise ValueError('STEP face has unbounded parameters; no bounded surface witness could be checked.')
        surface, points = BRepAdaptor_Surface(face), []
        # Parameter points are classified against the trimmed face before use.
        for u_fraction, v_fraction in [(u, v) for u in (.5,.25,.75,.125,.875,.0625,.9375) for v in (.5,.25,.75,.125,.875,.0625,.9375)]:
            u = bounds[0]+(bounds[1]-bounds[0])*u_fraction
            v = bounds[2]+(bounds[3]-bounds[2])*v_fraction
            classification = BRepClass_FaceClassifier(face, gp_Pnt2d(u, v), 1e-7)
            if classification.State() != TopAbs_IN: continue
            point = surface.Value(u, v)
            points.append((point.X(), point.Y(), point.Z()))
            if len(points) == 3: break
        kind = 'trimmed-face interior parameter sample'
        if not points:
            # Very small/sliver trimmed domains can evade the fixed grid. A
            # face vertex is a valid boundary witness, explicitly identified.
            vertices = TopExp_Explorer(face, TopAbs_VERTEX)
            if not vertices.More():
                raise ValueError(f'STEP face {index} has no valid bounded surface witness.')
            point = BRep_Tool.Pnt_s(TopoDS.Vertex(vertices.Current()))
            points = [(point.X(), point.Y(), point.Z())]
            kind = 'trimmed-face boundary vertex fallback'
        yield index, kind, points
        index += 1
        explorer.Next()


def check_mesh(path, shape, *, time_budget_seconds=45):
    """Check one binary STL against one validated, reopened STEP solid.

    Welding only identifies shared mesh vertices for topology; distances and
    signed volume use the original Float32 coordinates. A fixed weld tolerance
    accommodates export roundoff without silently changing the surface limit.
    Exhausting the time budget rejects the check; it never switches to a sample.
    """
    if not isinstance(time_budget_seconds, (int, float)) or isinstance(time_budget_seconds, bool) or not math.isfinite(time_budget_seconds) or time_budget_seconds <= 0:
        raise ValueError('Mesh verification needs a positive finite time budget.')
    started = time.monotonic()
    def deadline():
        if time.monotonic() - started > time_budget_seconds:
            raise ValueError('Full STL boundary verification exceeded its time budget. No partial surface check was accepted.')

    path = Path(path)
    if not 284 <= path.stat().st_size <= 84 + MAX_TRIANGLES * 50:
        raise ValueError('STL size is outside the bounded binary mesh limit.')
    data = path.read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    if not 4 <= count <= MAX_TRIANGLES or len(data) != 84 + count * 50:
        raise ValueError('STL binary triangle count or byte length is invalid.')

    vertices, cells, edges, centers, volume_terms, triangles = [], {}, {}, [], [], []
    parent = list(range(count))
    def find(value):
        while value != parent[value]:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value
    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[b] = a
    def vertex_id(point):
        cell = tuple(math.floor(value / WELD_MM) for value in point)
        matches = []
        for x in (-1, 0, 1):
            for y in (-1, 0, 1):
                for z in (-1, 0, 1):
                    for index in cells.get((cell[0]+x, cell[1]+y, cell[2]+z), ()):
                        distance2 = sum((point[k]-vertices[index][k])**2 for k in range(3))
                        if distance2 <= WELD_MM**2:
                            matches.append((distance2, index))
        if matches:
            return min(matches)[1]
        index = len(vertices)
        vertices.append(point)
        cells.setdefault(cell, []).append(index)
        return index

    reference = None
    for index in range(count):
        if index % 128 == 0:
            deadline()
        values = struct.unpack_from('<12f', data, 84 + index * 50)
        if not all(math.isfinite(value) for value in values):
            raise ValueError(f'STL triangle {index} contains non-finite values.')
        points = [tuple(values[3+3*j:6+3*j]) for j in range(3)]
        if any(abs(value) > MAX_COORDINATE_MM for point in points for value in point):
            raise ValueError('STL coordinates exceed the bounded CAD comparison range.')
        cross = _cross(_sub(points[1], points[0]), _sub(points[2], points[0]))
        if _dot(cross, cross) <= 1e-24:
            raise ValueError(f'STL triangle {index} has zero or numerically degenerate area.')
        triangles.append(points)
        ids = [vertex_id(point) for point in points]
        if len(set(ids)) != 3:
            raise ValueError(f'STL triangle {index} collapses within the fixed vertex weld tolerance.')
        for first, second in zip(ids, ids[1:] + ids[:1]):
            key = (min(first, second), max(first, second))
            direction = 1 if first < second else -1
            if key not in edges:
                edges[key] = [1, direction, index]
            else:
                entry = edges[key]
                entry[0] += 1
                entry[1] += direction
                if entry[0] > 2:
                    raise ValueError('STL has a non-manifold edge shared by more than two triangles.')
                union(index, entry[2])
        if reference is None:
            reference = points[0]
        a, b, c = (_sub(point, reference) for point in points)
        volume_terms.append(_dot(a, _cross(b, c)) / 6)
        centers.append(tuple(sum(point[k] for point in points)/3 for k in range(3)))
    if any(entry[0] != 2 or entry[1] != 0 for entry in edges.values()):
        raise ValueError('STL is not closed and consistently oriented: every edge must occur twice in opposite directions.')
    components = len({find(index) for index in range(count)})
    # A connected solid may legitimately have separate inner cavity shells.
    # Compare boundary component and orientation counts with the analytic STEP.
    component_terms = {}
    for index, term in enumerate(volume_terms):
        component_terms.setdefault(find(index), []).append(term)
    component_volumes = [math.fsum(terms) for terms in component_terms.values()]
    shell_volumes = []
    explorer = TopExp_Explorer(shape, TopAbs_SHELL)
    while explorer.More():
        shell_properties = GProp_GProps()
        BRepGProp.VolumeProperties_s(explorer.Current(), shell_properties)
        shell_volumes.append(shell_properties.Mass())
        explorer.Next()
    if components != len(shell_volumes):
        raise ValueError('STL boundary component count differs from the STEP shell count.')
    if any(abs(value) <= 1e-12 for value in component_volumes + shell_volumes) or sum(value > 0 for value in component_volumes) != sum(value > 0 for value in shell_volumes):
        raise ValueError('STL boundary shell orientations differ from the STEP outer/cavity shell orientations.')
    signed_volume = math.fsum(volume_terms)
    if not math.isfinite(signed_volume) or signed_volume <= 0:
        raise ValueError('STL must have positive signed volume with outward triangle orientation.')

    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties)
    step_volume = properties.Mass()
    BRepGProp.SurfaceProperties_s(shape, properties)
    step_area = properties.Mass()
    if not math.isfinite(step_volume) or step_volume <= 0 or not math.isfinite(step_area) or step_area <= 0:
        raise ValueError('STEP needs finite positive volume and boundary area for mesh comparison.')
    volume_tolerance = max(.01, step_area * CENTER_TOLERANCE_MM)
    volume_difference = abs(signed_volume - step_volume)
    if volume_difference > volume_tolerance:
        raise ValueError(f'STL signed volume differs from STEP by {volume_difference:.6g} mm³, exceeding the explicit tessellation allowance {volume_tolerance:.6g} mm³.')

    boundary = _boundary(shape)
    distance = BRepExtrema_DistShapeShape()
    distance.LoadS2(boundary)
    maximum, maximum_index = 0., 0
    for index, center in enumerate(centers):
        if index % 128 == 0:
            deadline()
        distance.LoadS1(BRepBuilderAPI_MakeVertex(gp_Pnt(*center)).Vertex())
        distance.Perform()
        if not distance.IsDone():
            raise ValueError(f'STL triangle {index} distance to the trimmed STEP boundary could not be computed.')
        value = distance.Value()
        if not math.isfinite(value) or value > CENTER_TOLERANCE_MM:
            raise ValueError(f'STL triangle {index} center is {value:.6g} mm from the trimmed STEP boundary; limit is {CENTER_TOLERANCE_MM} mm.')
        if value > maximum:
            maximum, maximum_index = value, index
    tree = _triangle_tree(triangles, list(range(count)), deadline)
    witnesses, face_count, reverse_maximum = [], 0, 0.
    for face_index, kind, points in _face_witnesses(shape):
        deadline()
        face_count += 1
        for point in points:
            value = _mesh_distance(point, tree, triangles)
            if not math.isfinite(value) or value > CENTER_TOLERANCE_MM:
                raise ValueError(f'STEP face {face_index} witness is {value:.6g} mm from the STL surface; limit is {CENTER_TOLERANCE_MM} mm.')
            reverse_maximum = max(reverse_maximum, value)
            witnesses.append({'face': face_index, 'kind': kind, 'point_mm': list(point), 'distance_mm': value})
    deadline()
    return {
        'passed': True, 'stl_triangles': count, 'boundary_components': components, 'step_boundary_shells': len(shell_volumes),
        'closed_oriented_topology': True, 'vertex_weld_tolerance_mm': WELD_MM,
        'signed_volume_mm3': signed_volume, 'step_volume_mm3': step_volume, 'step_boundary_area_mm2': step_area,
        'volume_difference_mm3': volume_difference, 'volume_tolerance_mm3': volume_tolerance,
        'volume_allowance_basis': 'STEP boundary area multiplied by the fixed center-distance tolerance; tessellation allowance, not exact analytic equality.',
        'checked_triangle_centers': count, 'maximum_center_distance_mm': maximum,
        'maximum_center_triangle': maximum_index, 'center_tolerance_mm': CENTER_TOLERANCE_MM,
        'step_faces_checked': face_count, 'step_surface_witnesses': witnesses,
        'maximum_face_witness_distance_mm': reverse_maximum,
        'seconds': time.monotonic() - started,
        'limits': ['All triangle centers were compared to trimmed STEP boundary faces; bounded witnesses from every STEP face were compared back to exact STL triangles. Surface regions between samples are not exhaustively covered.',
                   'These are sampled checks in both directions, not a two-way Hausdorff-distance proof or self-intersection proof.',
                   'Topology uses a fixed numerical vertex weld tolerance; physical fit, fabrication quality and strength remain untested.'],
    }
