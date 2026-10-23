"""Render the original tray STL in a separate Blender scene for visual QA.

Usage: Blender --background --factory-startup --python render.py -- --stl PATH [--lid-stl PATH] --out NEW_DIR
The render is illustrative. The STEP and OpenCascade fit report are the geometry
sources, and the manufacturer board models are not copied into this scene.
"""

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stl", required=True, type=Path)
    parser.add_argument("--lid-stl", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.stl = args.stl.expanduser().resolve(strict=True)
    if args.lid_stl:
        args.lid_stl = args.lid_stl.expanduser().resolve(strict=True)
    args.out = args.out.expanduser().resolve()
    if args.out.exists() or not args.out.parent.is_dir():
        parser.error("--out must be absent and its parent must exist")
    return args


def material(name, color, roughness=0.7, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    return mat


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area_light(name, location, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, (33, 22.5, 5))


def main():
    args = parse_args()
    args.out.mkdir()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=str(args.stl))
    tray = bpy.context.selected_objects[0]
    tray.name = "Hardware Studio prototype tray | 66 x 45 x 14 mm"
    tray.data.materials.clear()
    tray.data.materials.append(material("Sage technical model", (0.30, 0.49, 0.37), .55, .0))
    for poly in tray.data.polygons:
        poly.use_smooth = False
    cover = None
    if args.lid_stl:
        bpy.ops.wm.stl_import(filepath=str(args.lid_stl))
        cover = bpy.context.selected_objects[0]
        cover.name = "Separate lift-off cover | exploded +23 mm from seated STEP pose"
        cover.location.z = 23
        cover.data.materials.clear()
        cover.data.materials.append(material("Signal yellow cover study", (0.96, 0.89, 0.44), .62))
        for poly in cover.data.polygons:
            poly.use_smooth = False
    bpy.ops.mesh.primitive_plane_add(size=2, location=(33, 22.5, -0.8))
    floor = bpy.context.object
    floor.name = "Warm neutral backdrop"
    floor.scale = (65, 55, 1)
    floor.data.materials.append(material("Paper ivory", (0.86, 0.87, 0.79), .95))
    camera_data = bpy.data.cameras.new("Orthographic camera")
    camera = bpy.data.objects.new("Orthographic camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 136 if cover else 96
    area_light("Key softbox", (15, -15, 90), 1800, 85)
    area_light("Rim softbox", (80, 80, 70), 1350, 70)
    world = bpy.context.scene.world or bpy.data.worlds.new("Neutral studio")
    bpy.context.scene.world = world
    world.color = (0.55, 0.58, 0.51)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = .001  # STL numbers are millimeters.
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.cavity_valley_factor = 1.3
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.film_transparent = False
    scene.render.filepath = str(args.out / ("cover-exploded.jpg" if cover else "tray-isometric.jpg"))
    camera.location = (116, -110, 110 if cover else 91)
    aim(camera, (33, 22.5, 20 if cover else 4))
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out / ("cover-scene.blend" if cover else "tray-scene.blend")))
    bpy.ops.render.render(write_still=True)
    if cover:
        return
    camera.location = (33, 22.5, 105)
    aim(camera, (33, 22.5, 4))
    camera_data.ortho_scale = 77
    scene.render.filepath = str(args.out / "tray-top.jpg")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
