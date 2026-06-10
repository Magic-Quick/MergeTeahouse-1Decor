import fs from 'fs';

const scene = JSON.parse(fs.readFileSync('assets/Main.scene', 'utf8'));
const byId = new Map();
for (let i = 0; i < scene.length; i++) {
    const o = scene[i];
    byId.set(o.__id__ !== undefined ? o.__id__ : i, o);
}

const t150 = byId.get(150);
console.log('id 150:', JSON.stringify(t150));

const PREFAB = '893d15b9-f49a-4109-aa0d-fcfbcd4595ee';
const SLOTS = '98eYzYwDlFAKGxoYtoLt8h';
const GLOW = 'b1/sf30nBMZaS7F18+IL+l';
const ITEM_SPRITE = '11AB1Qs3lAc5EcyOEMAOAi';

const slots = scene.find((o) => o._name === 'Slots-layer' && o._id === SLOTS);
let wrongTarget = 0;
let wrongValue = 0;
let ok = 0;

for (const cid of slots._children) {
    const child = byId.get(cid.__id__ ?? cid);
    const pi = byId.get(child._prefab.__id__ ?? child._prefab);
    if (pi.asset?.__uuid__ !== PREFAB) continue;
    const inst = byId.get(pi.instance.__id__ ?? pi.instance);
    for (const oid of inst.propertyOverrides) {
        const ov = byId.get(oid.__id__ ?? oid);
        if (ov?.propertyPath?.[0] !== '_sizeMode') continue;
        const t = byId.get(ov.targetInfo?.__id__ ?? ov.targetInfo);
        const ids = t?.localID || [];
        if (ids.includes(GLOW)) {
            if (ov.value === 2) ok++;
            else wrongValue++;
        } else {
            wrongTarget++;
            console.log('sizeMode override targets', ids, 'value', ov.value, 'expected glow', GLOW);
        }
    }
}

console.log({ ok, wrongTarget, wrongValue });
