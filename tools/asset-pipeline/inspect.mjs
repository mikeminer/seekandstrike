import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = doc.getRoot();
  console.log('==', f);
  console.log('meshes', r.listMeshes().map(m => m.getName() + ':' + m.listPrimitives().map(p => (p.getIndices()?.getCount() ?? 0) / 3 + 't/' + p.getMaterial()?.getName() + '/' + p.listAttributes().length + 'a').join(',')).join(' | '));
  console.log('mats', r.listMaterials().map(m => m.getName()).join(', '));
  console.log('tex', r.listTextures().map(t => t.getName() + ' ' + t.getMimeType() + ' ' + (t.getSize()||[]).join('x')).join(', '));
  console.log('skins', r.listSkins().map(s => s.getName() + ':' + s.listJoints().length).join(','));
  console.log('anims', r.listAnimations().length, r.listAnimations().map(a => a.getName()).join(', '));
  const nodes = r.listNodes(); console.log('nodes', nodes.length, nodes.slice(0, 12).map(n => n.getName() + (n.getMesh() ? '[M]' : '') + (n.getSkin() ? '[S]' : '') + ' s=' + n.getScale().map(v=>v.toFixed(2)) + ' r=' + n.getRotation().map(v=>v.toFixed(2))).join('\n  '));
}
