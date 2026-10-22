"""Editable OpenCascade model of a two-board prototype tray. Units: millimeters.

Run with the pinned OCP interpreter documented in this example's README. This
exports only our original tray, never the manufacturer reference STEP files.
"""

import argparse
import hashlib
import json
import math
import sys
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


ROOT = Path(__file__).resolve().parent


def box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def cylinder(x, y, z, radius, height):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1)), radius, height).Shape()


def boolean(operation, first, second):
    result = operation(first, second)
    result.Build()
    if not result.IsDone() or not BRepCheck_Analyzer(result.Shape()).IsValid():
        raise RuntimeError(f"Invalid {operation.__name__} result")
    return result.Shape()


def bounds(shape):
    b = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, b, False, False)
    lo, hi = b.CornerMin(), b.CornerMax()
    return {
        "min_mm": [lo.X(), lo.Y(), lo.Z()],
        "max_mm": [hi.X(), hi.Y(), hi.Z()],
        "span_mm": [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()],
    }


def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def mount_centers(spec):
    p = spec["placements"]["pico"]
    s = spec["placements"]["stick"]
    holes = spec["source_model_holes"]
    pico = [(p["x_offset"] + z, p["y_offset"] + x) for x, z in holes["pico_xy_z"]]
    stick = [(s["x_offset"] + x, s["y_offset"] + y) for x, y in holes["stick_xy"]]
    return {"pico": pico, "stick": stick}


def validate_spec(spec):
    if spec["units"] != "mm":
        raise ValueError("Design must use millimeters")
    t, m = spec["tray"], spec["mounts"]
    for value in (t["length"], t["width"], t["height"], t["wall"], t["floor"],
                  m["boss_top_z"], m["locator_height"], m["locator_radius"],
                  m["pico_boss_radius"], m["stick_boss_radius"]):
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError("Geometry parameters must be positive finite numbers")
    if t["length"] <= 2 * t["wall"] or t["width"] <= 2 * t["wall"]:
        raise ValueError("Walls consume the tray cavity")
    if not t["floor"] < m["boss_top_z"] < t["height"]:
        raise ValueError("Boss top must be above the floor and below the rim")
    if m["locator_radius"] >= min(m["pico_boss_radius"], m["stick_boss_radius"]):
        raise ValueError("Locator pins must be narrower than their bosses")
    for centers in mount_centers(spec).values():
        for x, y in centers:
            if not (t["wall"] < x < t["length"] - t["wall"] and
                    t["wall"] < y < t["width"] - t["wall"]):
                raise ValueError("A mount falls outside the cavity")


def make_tray(spec, pin_radius=None):
    validate_spec(spec)
    t, m = spec["tray"], spec["mounts"]
    pin_radius = m["locator_radius"] if pin_radius is None else pin_radius
    tray = box(0, 0, 0, t["length"], t["width"], t["height"])
    cavity = box(t["wall"], t["wall"], t["floor"],
                 t["length"] - 2 * t["wall"],
                 t["width"] - 2 * t["wall"],
                 t["height"] - t["floor"] + 1)
    tray = boolean(BRepAlgoAPI_Cut, tray, cavity)
    y0, y1 = t["usb_notch_y"]
    notch = box(-1, y0, t["usb_notch_z_min"], t["wall"] + 2,
                y1 - y0, t["height"] - t["usb_notch_z_min"] + 1)
    tray = boolean(BRepAlgoAPI_Cut, tray, notch)
    for name, centers in mount_centers(spec).items():
        radius = m[f"{name}_boss_radius"]
        for x, y in centers:
            boss = cylinder(x, y, t["floor"] - .1, radius,
                            m["boss_top_z"] - t["floor"] + .1)
            tray = boolean(BRepAlgoAPI_Fuse, tray, boss)
            pin = cylinder(x, y, m["boss_top_z"] - .1, pin_radius,
                           m["locator_height"] + .1)
            tray = boolean(BRepAlgoAPI_Fuse, tray, pin)
    if not BRepCheck_Analyzer(tray).IsValid():
        raise RuntimeError("Finished tray is invalid")
    return tray


def export(shape, output):
    writer = STEPControl_Writer()
    Interface_Static.SetCVal_s("write.step.unit", "MM")
    if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
        raise RuntimeError("STEP transfer failed")
    if writer.Write(str(output / "tray.step")) != IFSelect_RetDone:
        raise RuntimeError("STEP write failed")
    mesh = BRepMesh_IncrementalMesh(shape, .04, False, .15, False)
    mesh.Perform()
    stl = StlAPI_Writer()
    stl.ASCIIMode = False
    if not stl.Write(shape, str(output / "tray.stl")):
        raise RuntimeError("STL write failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path,
                        help="New output directory; it must not already exist")
    args = parser.parse_args()
    output = args.out.expanduser().resolve()
    if output.exists() or not output.parent.is_dir():
        parser.error("--out must be absent and its parent must already exist")
    raw = (ROOT / "design.json").read_bytes()
    spec = json.loads(raw)
    tray = make_tray(spec)
    output.mkdir()
    export(tray, output)
    report = {
        "units": "mm", "model": "original analytic B-rep tray",
        "source_design_sha256": hashlib.sha256(raw).hexdigest(),
        "bounds": bounds(tray), "volume_mm3": volume(tray),
        "is_valid": BRepCheck_Analyzer(tray).IsValid(),
        "mount_centers_mm": mount_centers(spec),
        "vendor_models_included": False,
    }
    (output / "build-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
