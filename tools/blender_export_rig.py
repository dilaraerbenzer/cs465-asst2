"""
Blender -> WebGL export script for the moth.

HOW TO USE (Blender 4.x):
  1. Open your .blend file, go to the "Scripting" workspace.
  2. Open this file in the text editor, set EXPORT_DIR below to the repo's
     models/ folder, and press "Run Script".
  3. It writes:   models/moth.obj        (all parts, one "o <name>" per part)
                  models/moth.rig.json   (parent + pivot + colour of each part)

WHAT THE BLEND FILE MUST LOOK LIKE (see docs/MODELING.md):
  * One mesh object per movable part, named exactly like the part names the
    app uses (thorax, head, abdomen, forewing_L, leg_front_upper_L, ...).
  * Each object's ORIGIN is placed at its joint (where it rotates).
  * Objects are parented in Blender like the real hierarchy
    (head -> thorax, leg_front_lower_L -> leg_front_upper_L, ...).
    Use Ctrl+P -> "Object (Keep Transform)".
  * Rotation/scale applied (Ctrl+A -> Rotation & Scale) so the model sits in
    its rest pose. Do NOT apply location (that would move the origins).
"""
import json
import os

import bpy

EXPORT_DIR = bpy.path.abspath("//models")   # "//" = folder of the .blend file
BASENAME = "moth"


def to_y_up(v):
    # Blender is Z-up. The OBJ exporter below converts with forward=-Z, up=Y,
    # which maps Blender (x, y, z) -> (x, z, -y). Pivots must match that.
    return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]


def part_color(obj):
    """Base colour of the first material (Principled BSDF), else grey."""
    for slot in obj.material_slots:
        mat = slot.material
        if mat and mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    c = node.inputs["Base Color"].default_value
                    return [round(c[0], 4), round(c[1], 4), round(c[2], 4)]
        if mat:
            c = mat.diffuse_color
            return [round(c[0], 4), round(c[1], 4), round(c[2], 4)]
    return [0.5, 0.5, 0.5]


def main():
    os.makedirs(EXPORT_DIR, exist_ok=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.visible_get()]
    if not meshes:
        raise RuntimeError("No visible mesh objects to export")

    for o in meshes:
        if " " in o.name or "." in o.name:
            raise RuntimeError(f"Rename object '{o.name}': no spaces or dots allowed")

    # Parents must come before children in the JSON.
    ordered, seen = [], set()
    def visit(o):
        if o.name in seen:
            return
        if o.parent and o.parent in meshes:
            visit(o.parent)
        seen.add(o.name)
        ordered.append(o)
    for o in meshes:
        visit(o)

    rig = {"parts": [{
        "name": o.name,
        "parent": o.parent.name if (o.parent and o.parent in meshes) else None,
        "pivot": to_y_up(o.matrix_world.translation),
        "color": part_color(o),
    } for o in ordered]}

    rig_path = os.path.join(EXPORT_DIR, BASENAME + ".rig.json")
    with open(rig_path, "w") as f:
        json.dump(rig, f, indent=2)

    obj_path = os.path.join(EXPORT_DIR, BASENAME + ".obj")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.ops.wm.obj_export(
        filepath=obj_path,
        export_selected_objects=True,
        apply_modifiers=True,
        export_uv=True,
        export_normals=True,
        export_materials=True,       # writes moth.mtl (useful for textures later)
        export_triangulated_mesh=True,
        forward_axis="NEGATIVE_Z",
        up_axis="Y",
        global_scale=1.0,
    )
    print(f"Exported {len(meshes)} parts -> {obj_path}, {rig_path}")


main()
