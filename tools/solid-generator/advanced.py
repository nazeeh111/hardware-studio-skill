"""Trusted build123d operations for bounded profile and fillet data."""
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS


def library():
    try:
        import build123d as cad
    except ImportError as error:
        raise ValueError('Curved profiles and fillets require the project build123d CAD runtime. Run tools/cad-runtime/setup.sh, then restart the local server.') from error
    return cad


def curved_solid(feature):
    cad = library()
    x, y, z = feature['origin']
    axis = feature['axis']

    def position(point):
        u, v = point
        return {'x': (x, y + u, z + v), 'y': (x + v, y, z + u), 'z': (x + u, y + v, z)}[axis]

    edges, start = [], feature['start']
    for segment in feature['segments']:
        a, b = position(start), position(segment['end'])
        if segment['kind'] == 'line':
            edges.append(cad.Edge.make_line(a, b))
        else:
            edges.append(cad.Edge.make_three_point_arc(a, position(segment['via']), b))
        start = segment['end']
    wire = cad.Wire(edges, sequenced=True)
    if not wire.is_closed or not wire.is_valid:
        raise ValueError('Curved profile did not form one valid closed wire.')
    face = cad.Face(wire)
    if not face.is_valid or face.area <= 1e-7:
        raise ValueError('Curved profile did not form one valid positive-area planar face.')
    direction = {'x': (feature['height'], 0, 0), 'y': (0, feature['height'], 0), 'z': (0, 0, feature['height'])}[axis]
    return cad.Solid.extrude(face, direction).wrapped


def fillet_solid(shape, feature):
    cad = library()
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    if not explorer.More():
        raise ValueError('A fillet requires an existing solid.')
    part = cad.Solid(TopoDS.Solid(explorer.Current()))
    available, selected = part.edges(), []
    tolerance = feature['tolerance']
    for point in feature['edges']:
        matches = [edge for edge in available if edge.distance_to(tuple(point)) <= tolerance]
        if len(matches) != 1:
            raise ValueError(f'Fillet {feature["id"]}: edge point {point} matches {len(matches)} edges. Choose a point inside exactly one edge, away from vertices.')
        edge = matches[0]
        if any(vertex.distance_to(tuple(point)) <= tolerance for vertex in edge.vertices()):
            raise ValueError(f'Fillet {feature["id"]}: edge points must be away from edge vertices.')
        if any(edge.wrapped.IsSame(previous.wrapped) for previous in selected):
            raise ValueError(f'Fillet {feature["id"]}: two points select the same edge.')
        selected.append(edge)
    try:
        result = part.fillet(feature['radius'], selected)
    except (ValueError, RuntimeError) as error:
        raise ValueError(f'Fillet {feature["id"]}: radius {feature["radius"]} mm cannot be constructed on the selected edges. Source retained; choose another radius or edge set.') from error
    return result.wrapped, {'selected_edge_count': len(selected), 'radius_mm': feature['radius'], 'edge_points_mm': feature['edges'], 'selection_tolerance_mm': tolerance}
