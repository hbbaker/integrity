import { load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { surfaceTextures, surfaceMaterial, cssColor } = await load('surfaces');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

for (const kind of ['brushed', 'plate', 'circuit', 'weave', 'rubber', 'parkerized', 'knurl', 'ribbed']) {
  const textures = surfaceTextures(kind, { color: '#336699' });
  check(textures.map instanceof THREE.Texture && textures.bump === undefined, `${kind}: draws a colour map and no height map`);
  check(textures.map.colorSpace === THREE.SRGBColorSpace, `${kind}: colour is sRGB`);
  check(textures.map.wrapS === THREE.RepeatWrapping, `${kind}: the textures tile`);
}
check(surfaceTextures('brushed').emissive === null && surfaceTextures('weave').emissive === null && surfaceTextures('rubber').emissive === null && surfaceTextures('parkerized').emissive === null && surfaceTextures('knurl').emissive === null && surfaceTextures('ribbed').emissive === null, 'plain surfaces have no glow map');
check(surfaceTextures('plate').emissive && surfaceTextures('circuit').emissive, 'plating and circuits glow');
check(surfaceTextures('plate', { color: '#aa2200' }) === surfaceTextures('plate', { color: '#aa2200' }), 'the same surface is drawn once and shared');
check(surfaceTextures('plate', { color: '#aa2200' }) !== surfaceTextures('plate', { color: '#00aa22' }), 'a different colour is a different surface');
check(surfaceTextures('plate', { repeat: 3 }).map.repeat.x === 3, 'the tiling is an option');
let threw = false;
try { surfaceTextures('marble'); } catch (error) { threw = /unknown surface kind "marble"/.test(error.message); }
check(threw, 'an unknown kind is refused with a clear message');

const a = surfaceMaterial('plate', { color: '#f2c200', glow: '#3dff9a', bumpScale: 3 });
const b = surfaceMaterial('plate', { color: '#f2c200', glow: '#3dff9a' });
check(a instanceof THREE.MeshPhongMaterial && !a.bumpMap && a.map, 'a surface material is Phong with a colour map and no bump map');
check(a.emissiveMap && a.emissive.getHex() === 0xffffff && a.emissiveIntensity > 1, 'and a glow map that shines');
check(a !== b && a.map === b.map, 'each call is a new material over shared textures');
const flashable = surfaceMaterial('plate', { color: '#f2c200', glowing: false });
check(!flashable.emissiveMap && flashable.emissive.getHex() === 0, 'glowing: false has no glow map (so a hit flash covers the whole surface)');
check(surfaceMaterial('weave').emissiveMap === null, 'a surface with nothing to glow gets no glow map');
check(cssColor(0xf2c200) === '#f2c200' && cssColor(0x0000ff) === '#0000ff', 'a hex number becomes a css colour');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
