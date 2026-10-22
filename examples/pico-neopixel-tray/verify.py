"""Fresh-process fit check against manufacturer STEP files and exported tray STEP.

This uses the same OpenCascade kernel for build and readback. It checks geometry
and sensitivity to known interference, not print accuracy or full product safety.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Trsf, gp_Vec

from model import make_tray, mount_centers

ROOT = Path(__file__).resolve().parent


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_step(path):
    text = path.read_text(errors="ignore")
    if ".MILLI." not in text or ".METRE." not in text:
        raise ValueError(f"STEP does not clearly declare millimeter units: {path}")
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone or reader.TransferRoots() < 1:
        raise RuntimeError(f"STEP import failed: {path}")
    shape = reader.OneShape()
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid():
        raise RuntimeError(f"Invalid imported STEP: {path}")
    return shape


def bounds(shape):
    b = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, b, False, False)
    a, z = b.CornerMin(), b.CornerMax()
    return {
        "min_mm": [a.X(), a.Y(), a.Z()],
        "max_mm": [z.X(), z.Y(), z.Z()],
        "span_mm": [z.X() - a.X(), z.Y() - a.Y(), z.Z() - a.Z()],
    }


def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def intersection_volume(a, b):
    operation = BRepAlgoAPI_Common(a, b)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError("Intersection failed")
    return volume(operation.Shape())


def translated(shape, xyz):
    transform = gp_Trsf()
    transform.SetTranslation(gp_Vec(*xyz))
    return BRepBuilderAPI_Transform(shape, transform, True).Shape()


def placed_pico(shape, placement):
    # Source axes: x=board width, y=height, z=board length. This is a proper
    # cyclic rotation, then translation: world=(source z, source x, source y).
    transform = gp_Trsf()
    transform.SetValues(0, 0, 1, placement["x_offset"],
                        1, 0, 0, placement["y_offset"],
                        0, 1, 0, placement["z_offset"])
    return BRepBuilderAPI_Transform(shape, transform, True).Shape()


def hole_centers(shape, radius, plane):
    iterator = TopExp_Explorer(shape, TopAbs_FACE)
    found = set()
    while iterator.More():
        face = BRepAdaptor_Surface(TopoDS.Face(iterator.Current()))
        if face.GetType() == GeomAbs_Cylinder:
            cylinder = face.Cylinder()
            direction = cylinder.Axis().Direction()
            if abs(cylinder.Radius() - radius) < .015:
                p = cylinder.Location()
                if plane == "xz" and abs(direction.Y()) > .99:
                    found.add((round(p.X(), 3), round(p.Z(), 3)))
                elif plane == "xy" and abs(direction.Z()) > .99:
                    found.add((round(p.X(), 3), round(p.Y(), 3)))
        iterator.Next()
    return sorted(found)


def inner_clearances(box, tray):
    cavity = [tray["wall"], tray["length"] - tray["wall"],
              tray["wall"], tray["width"] - tray["wall"]]
    a, z = box["min_mm"], box["max_mm"]
    return [a[0] - cavity[0], cavity[1] - z[0],
            a[1] - cavity[2], cavity[3] - z[1]]


def count_solids(shape):
    iterator = TopExp_Explorer(shape, TopAbs_SOLID)
    n = 0
    while iterator.More():
        n += 1
        iterator.Next()
    return n


def usb_overhang_bounds(pico):
    # The PCB's leading edge is at x=9 mm in this placement. Manufacturer STEP
    # solids before that edge are the modeled micro-USB connector pieces.
    iterator = TopExp_Explorer(pico, TopAbs_SOLID)
    boxes = []
    while iterator.More():
        b = bounds(iterator.Current())
        if b["min_mm"][0] < 8.9:
            boxes.append(b)
        iterator.Next()
    if not boxes:
        raise AssertionError("Pico source model has no USB overhang solids")
    lo = [min(b["min_mm"][i] for b in boxes) for i in range(3)]
    hi = [max(b["max_mm"][i] for b in boxes) for i in range(3)]
    return {"min_mm": lo, "max_mm": hi}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tray", required=True, type=Path)
    parser.add_argument("--pico-step", required=True, type=Path)
    parser.add_argument("--stick-step", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path,
                        help="New report directory; must not already exist")
    args = parser.parse_args()
    paths = [p.expanduser().resolve(strict=True) for p in
             (args.tray, args.pico_step, args.stick_step)]
    output = args.out.expanduser().resolve()
    if output.exists() or not output.parent.is_dir():
        parser.error("--out must be absent and its parent must already exist")
    spec = json.loads((ROOT / "design.json").read_text())
    tray, pico_raw, stick_raw = [load_step(path) for path in paths]
    tolerance = spec["acceptance"]
    expected_outer = [spec["tray"][name] for name in ("length", "width", "height")]
    actual_outer = bounds(tray)["span_mm"]
    if max(abs(a - b) for a, b in zip(actual_outer, expected_outer)) > tolerance["dimension_tolerance_mm"]:
        raise AssertionError(f"Reimported tray dimensions differ: {actual_outer}")
    if count_solids(tray) != 1:
        raise AssertionError("Tray STEP must contain one solid")
    source_holes = spec["source_model_holes"]
    radial = {"pico": source_holes["pico_hole_radius"] - spec["mounts"]["locator_radius"],
              "stick": source_holes["stick_hole_radius"] - spec["mounts"]["locator_radius"]}
    if min(radial.values()) <= 0:
        raise AssertionError("Locator pins have no nominal radial clearance")
    actual_pico_holes = hole_centers(pico_raw, source_holes["pico_hole_radius"], "xz")
    actual_stick_holes = hole_centers(stick_raw, source_holes["stick_hole_radius"], "xy")
    if actual_pico_holes != sorted(tuple(pair) for pair in source_holes["pico_xy_z"]):
        raise AssertionError(f"Pico hole centers differ from source STEP: {actual_pico_holes}")
    if actual_stick_holes != sorted(tuple(pair) for pair in source_holes["stick_xy"]):
        raise AssertionError(f"Stick hole centers differ from source STEP: {actual_stick_holes}")
    pico = placed_pico(pico_raw, spec["placements"]["pico"])
    stick = translated(stick_raw, tuple(spec["placements"]["stick"][k] for k in
                                        ("x_offset", "y_offset", "z_offset")))
    pico_box, stick_box = bounds(pico), bounds(stick)
    usb = usb_overhang_bounds(pico)
    notch_y0, notch_y1 = spec["tray"]["usb_notch_y"]
    if not (notch_y0 < usb["min_mm"][1] and notch_y1 > usb["max_mm"][1] and
            spec["tray"]["usb_notch_z_min"] < usb["min_mm"][2] and
            spec["tray"]["height"] > usb["max_mm"][2]):
        raise AssertionError("USB wall notch does not cover the modeled connector's Y/Z envelope")
    for label, box, expected in (("pico", pico_box, spec["envelopes"]["pico_step_mm"]),
                                 ("stick", stick_box, spec["envelopes"]["stick_step_mm"])):
        if max(abs(a - b) for a, b in zip(box["span_mm"], expected)) > tolerance["dimension_tolerance_mm"]:
            raise AssertionError(f"{label} source STEP envelope changed: {box['span_mm']}")
        if min(inner_clearances(box, spec["tray"])) < tolerance["min_envelope_wall_clearance_mm"]:
            raise AssertionError(f"{label} too close to a cavity wall")
        if box["max_mm"][2] >= spec["tray"]["height"]:
            raise AssertionError(f"{label} reaches the tray rim")
    # Published size is a slightly larger envelope than Adafruit's supplied
    # STEP. Check the conservative published X/Y/Z extents from the same origin.
    published = spec["envelopes"]["stick_published_mm"]
    published_box = {"min_mm": stick_box["min_mm"],
                     "max_mm": [a + b for a, b in zip(stick_box["min_mm"], published)]}
    if min(inner_clearances(published_box, spec["tray"])) < tolerance["min_envelope_wall_clearance_mm"]:
        raise AssertionError("Published stick dimensions do not fit the cavity")
    fits = {name: intersection_volume(tray, board) for name, board in
            (("pico", pico), ("stick", stick))}
    fits["between_boards"] = intersection_volume(pico, stick)
    if any(v > tolerance["overlap_limit_mm3"] for v in fits.values()):
        raise AssertionError(f"Unexpected board/tray overlap: {fits}")
    negative = {
        "pico_shifted_into_wall_mm3": intersection_volume(tray, translated(pico, (0, -3, 0))),
        "oversize_locator_pico_mm3": intersection_volume(make_tray(spec, pin_radius=1.25), pico),
        "oversize_locator_stick_mm3": intersection_volume(make_tray(spec, pin_radius=1.25), stick),
    }
    if any(v < tolerance["negative_overlap_min_mm3"] for v in negative.values()):
        raise AssertionError(f"Known interference was not detected: {negative}")
    revised = json.loads(json.dumps(spec))
    revised["tray"]["width"] += 4
    revised["placements"]["stick"]["y_offset"] += 4
    revised_tray = make_tray(revised)
    revised_stick = translated(stick_raw, tuple(revised["placements"]["stick"][k] for k in
                                                ("x_offset", "y_offset", "z_offset")))
    if intersection_volume(revised_tray, revised_stick) > tolerance["overlap_limit_mm3"]:
        raise AssertionError("Revised-width design collides with the stick")
    output.mkdir()
    report = {
        "scope": "same-kernel STEP readback and manufacturer-model geometric fit; no physical or second-CAD-system test",
        "units": "mm", "tray_bounds": bounds(tray),
        "source_files_sha256": {key: sha256(path) for key, path in
                                zip(("tray", "pico", "stick"), paths)},
        "source_model_holes_mm": {"pico": actual_pico_holes, "stick": actual_stick_holes},
        "nominal_locator_radial_clearance_mm": radial,
        "mount_centers_mm": mount_centers(spec),
        "placed_envelopes_mm": {"pico": pico_box, "stick": stick_box,
                                 "published_stick": published_box},
        "usb_model_overhang_mm": usb,
        "notch_covers_modeled_usb_connector_envelope": True,
        "minimum_wall_clearance_mm": {
            "pico": min(inner_clearances(pico_box, spec["tray"])),
            "stick_published": min(inner_clearances(published_box, spec["tray"])),
        },
        "nominal_intersection_mm3": fits,
        "known_interference_mm3": negative,
        "revised_width_mm": revised["tray"]["width"],
        "revised_stick_intersection_mm3": intersection_volume(revised_tray, revised_stick),
        "all_assertions_passed": True,
    }
    (output / "fit-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
