/**
 * SEEK & STRIKE offline asset build (NOT shipped, not part of the game bundle).
 * Inputs: CC0 source packs downloaded to $SRC (default /tmp/s2), see ASSETS_LICENSES.md.
 * Outputs: public/assets/models/{soldier.glb, rifle.glb} (meshopt + WebP).
 *
 *   node build-assets.mjs            # SRC=/tmp/s2 by default
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, dedup, resample, simplifyPrimitive, weldPrimitive, quantize, meshopt as meshoptFn, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC = process.env.SRC ?? '/tmp/s2';
const OUT = path.resolve(import.meta.dirname, '../../public/assets/models');
mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});

const UBC = `${SRC}/ubc/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`;
const UAL1 = `${SRC}/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb`;
const UAL2 = `${SRC}/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb`;
const RIFLE = `${SRC}/rifle.glb`;

/** Clips kept (source name -> game name). Everything else is dropped. */
const CLIPS1 = {
  Idle_Loop: 'idle', Walk_Loop: 'walk', Jog_Fwd_Loop: 'run', Sprint_Loop: 'sprint',
  Crouch_Idle_Loop: 'crouchIdle', Crouch_Fwd_Loop: 'crouchWalk',
  Pistol_Idle_Loop: 'aimIdle', Pistol_Aim_Neutral: 'aim', Pistol_Aim_Up: 'aimUp', Pistol_Aim_Down: 'aimDown',
  Pistol_Shoot: 'fire', Pistol_Reload: 'reload', Hit_Chest: 'hit', Death01: 'death', Fixing_Kneeling: 'kneelWork',
};
const CLIPS2 = { LayToIdle: 'getUp', Hit_Knockback: 'knockback' };

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function copyClips(dst, srcPath, map) {
  const src = await io.read(srcPath);
  const byName = new Map(dst.getRoot().listNodes().map((n) => [n.getName(), n]));
  const buf = dst.getRoot().listBuffers()[0];
  for (const a of src.getRoot().listAnimations()) {
    const name = map[a.getName()];
    if (!name) continue;
    const na = dst.createAnimation(name);
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode(); const p = ch.getTargetPath();
      const bone = node?.getName();
      // Never retarget root motion/rotation (UAL root carries the Z-up fix); only pelvis translates.
      if (!bone || bone === 'root' || p === 'scale' || (p === 'translation' && bone !== 'pelvis')) continue;
      const target = byName.get(bone);
      if (!target) continue;
      const s = ch.getSampler();
      const inp = dst.createAccessor().setType('SCALAR').setArray(s.getInput().getArray().slice()).setBuffer(buf);
      const out = dst.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buf);
      const ns = dst.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation(s.getInterpolation());
      na.addSampler(ns).addChannel(dst.createAnimationChannel().setTargetNode(target).setTargetPath(p).setSampler(ns));
    }
  }
}

async function webp(doc, maxSize) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxSize, maxSize], quality: 82 }));
}

// ---------------- Soldier ----------------
{
  const doc = await io.read(UBC);
  const root = doc.getRoot();
  for (const n of root.listNodes()) if (n.getMesh() && n.getName() !== 'SuperHero_Male') { n.getMesh().dispose(); n.dispose(); }
  const bodyNode = root.listNodes().find((n) => n.getName() === 'SuperHero_Male');
  bodyNode.setName('Body');
  const prim = bodyNode.getMesh().listPrimitives()[0];
  for (const s of ['TEXCOORD_1', 'COLOR_0', 'COLOR_1']) prim.setAttribute(s, null);
  bodyNode.getMesh().setName('Body');
  prim.getMaterial().setName('Soldier_Body').setDoubleSided(false);
  // LOD1: same skin + material, ~25% triangles (silhouette/skinning preserved by meshopt).
  const lodMesh = doc.createMesh('Body_LOD1');
  const lp = prim.clone();
  weldPrimitive(lp, {});
  simplifyPrimitive(lp, { simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.01 });
  lodMesh.addPrimitive(lp);
  const lodNode = doc.createNode('Body_LOD1').setMesh(lodMesh).setSkin(bodyNode.getSkin());
  for (const p of root.listScenes()[0].listChildren()) if (p.listChildren().includes(bodyNode)) p.addChild(lodNode);
  if (!lodNode.getParentNode()) root.listScenes()[0].addChild(lodNode);
  await copyClips(doc, UAL1, CLIPS1);
  await copyClips(doc, UAL2, CLIPS2);
  await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune());
  await webp(doc, 1024);
  // Roughness at 512 is plenty.
  for (const t of root.listTextures()) {
    if ((t.getName() ?? '').match(/Rough/i) || t.getURI().match(/Rough/i)) {
      t.setImage(await sharp(t.getImage()).resize(512, 512).webp({ quality: 80 }).toBuffer());
    }
  }
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshoptFn({ encoder: MeshoptEncoder, level: 'medium' }));
  const tris = root.listMeshes().map((m) => `${m.getName()}=${m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0)}`);
  const bin = await io.writeBinary(doc);
  writeFileSync(`${OUT}/soldier.glb`, bin);
  console.log('soldier.glb', bin.byteLength, sha(bin), tris.join(' '), 'clips', root.listAnimations().map((a) => a.getName()).join(','));
}

// ---------------- Rifle ----------------
{
  const doc = await io.read(RIFLE);
  const root = doc.getRoot();
  const node = root.listNodes()[0];
  node.setName('Rifle');
  const mesh = node.getMesh(); mesh.setName('Rifle');
  mesh.listPrimitives()[0].getMaterial().setName('Rifle');
  const lodMesh = doc.createMesh('Rifle_LOD1');
  const lp = mesh.listPrimitives()[0].clone();
  // Third-person LOD: geometry only (UV seams of the AI unwrap block simplification); a flat
  // dark polymer material replaces the texture at that size. Normals rebuilt at load time.
  lp.setAttribute('TEXCOORD_0', null).setAttribute('NORMAL', null);
  lp.setMaterial(doc.createMaterial('Rifle_LOD1').setBaseColorFactor([0.09, 0.09, 0.1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0.3));
  weldPrimitive(lp, { tolerance: 0.0005 });
  simplifyPrimitive(lp, { simplifier: MeshoptSimplifier, ratio: 0.1, error: 0.01 });
  lodMesh.addPrimitive(lp);
  root.listScenes()[0].addChild(doc.createNode('Rifle_LOD1').setMesh(lodMesh));
  await doc.transform(dedup(), prune());
  await webp(doc, 1024);
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshoptFn({ encoder: MeshoptEncoder, level: 'medium' }));
  const tris = root.listMeshes().map((m) => `${m.getName()}=${m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0)}`);
  const bin = await io.writeBinary(doc);
  writeFileSync(`${OUT}/rifle.glb`, bin);
  console.log('rifle.glb', bin.byteLength, sha(bin), tris.join(' '));
}
for (const f of [UBC, UAL1, UAL2, RIFLE]) console.log('src', path.basename(f), sha(readFileSync(f)));
