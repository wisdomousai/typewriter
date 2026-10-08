"""Export the typewriter for the page: its mesh and skeleton, and nothing else. The page
animates every bone live, so there are no clips, and it builds its own materials, so
materials only travel as names (Shell, Joint, Glow, ...) that tell it which part is which.

    Blender -b --factory-startup -P blender/export.py -- OUT.glb

blender/build.sh runs this and compresses the result into public/models/.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402
import typewriter  # noqa: E402

def join(rig, parts):
    """One skinned mesh: the exporter splits it into one primitive per material."""
    target = parts[0]
    with bpy.context.temp_override(active_object=target, object=target, selected_objects=parts,
                                   selected_editable_objects=parts):
        bpy.ops.object.join()
    target.name = target.data.name = rig.name.replace('Rig', 'Body')
    return target


def strip_textures(obj):
    """The face screen is drawn by the page, so no image goes into the file."""
    for mat in obj.data.materials:
        for node in list(mat.node_tree.nodes):
            if node.type == 'TEX_IMAGE':
                mat.node_tree.nodes.remove(node)


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :]
    out = os.path.abspath(argv[0])
    kit.reset_scene()
    typewriter.write_geometry()
    rig, parts = typewriter.build('ink', 'glow')
    body = join(rig, parts)
    strip_textures(body)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_animations=False,
        export_skins=True,
        export_apply=False,  # keep the Armature modifier live: the mesh stays skinned
        export_yup=True,
        export_texcoords=True,  # the face screen's UVs
        export_normals=True,
        export_tangents=False,
        export_extras=False,
    )
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print('EXPORTED', out, 'bones', len(rig.data.bones), 'verts', len(body.data.vertices), 'tris', tris,
          'materials', [m.name for m in body.data.materials])


if __name__ == '__main__':
    main()
