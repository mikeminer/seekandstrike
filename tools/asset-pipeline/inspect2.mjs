import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = doc.getRoot();
  const s = r.listSkins()[0];
  console.log('==', f.split('/').pop(), 'scene bounds', JSON.stringify(getBounds(r.listScenes()[0])));
  if (s) console.log(s.listJoints().map(j=>j.getName()).join(' '));
  const top = r.listScenes()[0].listChildren(); console.log('top', top.map(n=>n.getName()+' s='+n.getScale()+' r='+n.getRotation().map(v=>v.toFixed(2))+' t='+n.getTranslation().map(v=>v.toFixed(2))));
  const root = r.listNodes().find(n=>n.getName()==='root'); if (root) console.log('root', root.getRotation(), root.getTranslation());
  const pel = r.listNodes().find(n=>n.getName()==='pelvis'); if (pel) console.log('pelvis', pel.getRotation(), pel.getTranslation());
}
