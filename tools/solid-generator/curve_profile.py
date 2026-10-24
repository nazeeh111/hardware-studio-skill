"""Bounded data-only analytic line/three-point-arc profiles; JS contract mirror."""
import math

EPS = 1e-7
TAU = 2 * math.pi


def sub(a, b): return [a[0] - b[0], a[1] - b[1]]
def dot(a, b): return a[0] * b[0] + a[1] * b[1]
def cross(a, b): return a[0] * b[1] - a[1] * b[0]
def distance(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])
def near(a, b): return distance(a, b) <= EPS
def mod(a): return a % TAU


def point(raw, label):
    if (not isinstance(raw, list) or len(raw) != 2 or
        any(isinstance(n, bool) or not isinstance(n, (int, float)) or abs(n) > 500 or not math.isfinite(n) for n in raw)):
        raise ValueError(f'{label} needs two finite coordinates within 500 mm.')
    return raw.copy()


def arc_geometry(start_raw, via_raw, end_raw):
    a, b, c = point(start_raw, 'Arc start'), point(via_raw, 'Arc via'), point(end_raw, 'Arc end')
    ab, ac, bc = sub(b, a), sub(c, a), sub(c, b)
    det, chord = cross(ab, ac), math.hypot(*ac)
    if min(math.hypot(*ab), chord, math.hypot(*bc)) <= EPS or abs(det) <= EPS * chord:
        raise ValueError('Arc points must be distinct and noncollinear.')
    ab2, ac2 = dot(ab, ab), dot(ac, ac)
    center = [a[0] + (ab2 * ac[1] - ac2 * ab[1]) / (2 * det), a[1] + (ab[0] * ac2 - ac[0] * ab2) / (2 * det)]
    radius = distance(a, center)
    if not math.isfinite(radius) or radius < .01 or radius > 500:
        raise ValueError('Arc radius must be 0.01–500 mm.')
    start_angle = math.atan2(a[1] - center[1], a[0] - center[0])
    end_angle = math.atan2(c[1] - center[1], c[0] - center[0])
    via_angle = math.atan2(b[1] - center[1], b[0] - center[0])
    ccw = mod(end_angle - start_angle)
    sweep = ccw if mod(via_angle - start_angle) < ccw else ccw - TAU
    return dict(center=center, radius=radius, startAngle=start_angle, sweep=sweep)


def on_arc(g, p):
    if abs(distance(g['center'], p) - g['radius']) > EPS: return False
    if near(p, g['a']) or near(p, g['b']): return True
    angle = math.atan2(p[1] - g['center'][1], p[0] - g['center'][0])
    travel = mod(angle - g['startAngle']) if g['sweep'] > 0 else mod(g['startAngle'] - angle)
    return travel <= abs(g['sweep']) + EPS / g['radius']


def on_line(e, p):
    v, w = sub(e['b'], e['a']), sub(p, e['a'])
    length = math.hypot(*v)
    return abs(cross(v, w)) <= EPS * length and -EPS * length <= dot(w, v) <= dot(v, v) + EPS * length


def within(e, p): return on_arc(e, p) if e['kind'] == 'arc' else on_line(e, p)


def line_line(a, b):
    r, s, q = sub(a['b'], a['a']), sub(b['b'], b['a']), sub(b['a'], a['a'])
    den, lr, ls = cross(r, s), math.hypot(*r), math.hypot(*s)
    if abs(den) <= 1e-12 * lr * ls:
        if abs(cross(q, r)) > EPS * lr: return False, []
        t0 = dot(q, r) / dot(r, r)
        t1 = t0 + dot(s, r) / dot(r, r)
        low, high = max(0, min(t0, t1)), min(1, max(t0, t1))
        if (high - low) * lr > EPS: return True, []
        return False, [p for p in [a['a'], a['b'], b['a'], b['b']] if on_line(a, p) and on_line(b, p)]
    t, u = cross(q, s) / den, cross(q, r) / den
    return False, [[a['a'][0] + t * r[0], a['a'][1] + t * r[1]]] if -EPS / lr <= t <= 1 + EPS / lr and -EPS / ls <= u <= 1 + EPS / ls else []


def line_arc(line, arc):
    v = sub(line['b'], line['a'])
    length = math.hypot(*v)
    unit, q = [n / length for n in v], sub(arc['center'], line['a'])
    projection = dot(q, unit)
    h2 = arc['radius'] ** 2 - (dot(q, q) - projection ** 2)
    if h2 < -EPS * (2 * arc['radius'] + EPS): return False, []
    h, points = math.sqrt(max(0, h2)), []
    for t in [projection - h, projection + h]:
        if -EPS <= t <= length + EPS:
            p = [line['a'][0] + t * unit[0], line['a'][1] + t * unit[1]]
            if on_arc(arc, p): points.append(p)
    return False, points


def intervals(arc):
    start = mod(arc['startAngle'] if arc['sweep'] > 0 else arc['startAngle'] + arc['sweep'])
    end = start + abs(arc['sweep'])
    return [[start, end]] if end <= TAU else [[start, TAU], [0, end - TAU]]


def arc_arc(a, b):
    delta = sub(b['center'], a['center'])
    d = math.hypot(*delta)
    if d <= EPS and abs(a['radius'] - b['radius']) <= EPS:
        overlap = any((min(x[1], y[1]) - max(x[0], y[0])) * a['radius'] > EPS for x in intervals(a) for y in intervals(b))
        return overlap, [p for p in [a['a'], a['b'], b['a'], b['b']] if on_arc(a, p) and on_arc(b, p)]
    if d <= EPS or d > a['radius'] + b['radius'] + EPS or d < abs(a['radius'] - b['radius']) - EPS: return False, []
    along = (a['radius'] ** 2 - b['radius'] ** 2 + d * d) / (2 * d)
    h2 = a['radius'] ** 2 - along ** 2
    if h2 < -EPS * (2 * a['radius'] + EPS): return False, []
    h, u = math.sqrt(max(0, h2)), [n / d for n in delta]
    base = [a['center'][0] + along * u[0], a['center'][1] + along * u[1]]
    points = [[base[0] - sign * h * u[1], base[1] + sign * h * u[0]] for sign in [1, -1]]
    return False, [p for p in points if on_arc(a, p) and on_arc(b, p)]


def intersections(a, b):
    if a['kind'] == 'line': return line_line(a, b) if b['kind'] == 'line' else line_arc(a, b)
    return line_arc(b, a) if b['kind'] == 'line' else arc_arc(a, b)


def validate_curve_profile(start_raw, segments_raw):
    start = point(start_raw, 'Curve start')
    if not isinstance(segments_raw, list) or not 2 <= len(segments_raw) <= 64:
        raise ValueError('Curve needs 2–64 line or arc segments.')
    segments = []
    for i, s in enumerate(segments_raw):
        if not isinstance(s, dict) or s.get('kind') not in ('line', 'arc') or set(s) - ({'kind', 'end'} if s.get('kind') == 'line' else {'kind', 'via', 'end'}):
            raise ValueError(f'Curve segment {i + 1} has unsupported fields or kind.')
        item = dict(kind=s['kind'])
        if s['kind'] == 'arc': item['via'] = point(s.get('via'), 'Arc via')
        item['end'] = point(s.get('end'), 'Curve end')
        segments.append(item)
    if not near(segments[-1]['end'], start): raise ValueError('Curve must close explicitly at its start.')
    segments[-1]['end'] = start.copy()
    previous, area2, edges = start, 0, []
    for s in segments:
        a, b = previous, s['end']
        previous = b
        if distance(a, b) < .01: raise ValueError('Curve edge chords must be at least 0.01 mm.')
        edge = dict(kind=s['kind'], a=a, b=b)
        if s['kind'] == 'arc': edge.update(arc_geometry(a, s['via'], b))
        area2 += edge['center'][0] * (b[1] - a[1]) - edge['center'][1] * (b[0] - a[0]) + edge['radius'] ** 2 * edge['sweep'] if s['kind'] == 'arc' else cross(a, b)
        edges.append(edge)
    for i, a in enumerate(edges):
        for j in range(i + 1, len(edges)):
            b, allowed = edges[j], []
            if j == i + 1: allowed.append(a['b'])
            if i == 0 and j == len(edges) - 1: allowed.append(a['a'])
            overlap, points = intersections(a, b)
            if overlap or any(not any(near(p, q) for q in allowed) for p in points):
                raise ValueError('Curve edges cross, touch or overlap away from a shared endpoint.')
            for p in [a['a'], a['b'], b['a'], b['b']]:
                if within(a, p) and within(b, p) and not any(near(p, q) for q in allowed):
                    raise ValueError('Curve edges cross or touch away from a shared endpoint.')
    if abs(area2 / 2) <= EPS: raise ValueError('Curve needs nonzero enclosed area.')
    return dict(start=start, segments=segments)


def curve_profile_bounds(start, segments):
    wire = validate_curve_profile(start, segments)
    points, previous = [wire['start']], wire['start']
    for s in wire['segments']:
        points.append(s['end'])
        if s['kind'] == 'arc':
            arc = dict(a=previous, b=s['end'], **arc_geometry(previous, s['via'], s['end']))
            for angle in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
                p = [arc['center'][0] + arc['radius'] * math.cos(angle), arc['center'][1] + arc['radius'] * math.sin(angle)]
                if on_arc(arc, p): points.append(p)
        previous = s['end']
    return dict(min=[min(p[i] for p in points) for i in [0, 1]], max=[max(p[i] for p in points) for i in [0, 1]])
