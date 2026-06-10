import fs from 'fs';
import path from 'path';

const scenePath = 'assets/Main.scene';
const glowDir = 'assets/sprites/furnituregreen/Glow';
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));

const GLOW_SPRITE_LOCAL_ID = 'b1/sf30nBMZaS7F18+IL+l';
const GLOW_TRANSFORM_LOCAL_ID = '50/L1g29lCnrRp9Z71wVtD';
const GLOW_NODE_LOCAL_ID = 'c1bWg57GxL/L4CQrFvzYAi';
const ITEM_SPRITE_TRANSFORM_LOCAL_ID = '6fnJ0vCMdLlLvWQ3FNv0SP';
const ITEM_SPRITE_NODE_LOCAL_ID = '24nDhoWyJNOLD2NS4p68tm';
const ROOT_LOCAL_ID = '10Yuvo4m1HJ7TFEqtHHheX';
const DRAGGABLE_PREFAB_UUID = '893d15b9-f49a-4109-aa0d-fcfbcd4595ee';
const SLOTS_LAYER_ID = '98eYzYwDlFAKGxoYtoLt8h';
const REFERENCE_ITEM_NAME = 'DiningSet';
const PREFAB_ITEM_SPRITE_SIZE = { width: 234, height: 174 };
const PREFAB_ITEM_SPRITE_NODE_SCALE = { x: 1, y: 1 };
const PREFAB_GLOW_NODE_SCALE = { x: 1.295, y: 1.295 };
const GLOW_SIZE_MODE_CUSTOM = 0;

const glowMap = {};
for (const file of fs.readdirSync(glowDir)) {
    if (!file.endsWith('.png.meta')) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(glowDir, file), 'utf8'));
    const base = file.replace('_Glow.png.meta', '').replace('.png.meta', '');
    const frameMeta = meta.subMetas?.f9941;
    const sf = frameMeta?.uuid || `${meta.uuid}@f9941`;
    const userData = frameMeta?.userData || {};
    glowMap[base] = {
        uuid: sf,
    };
}

function round1(n) {
    return Math.round(n * 10) / 10;
}

function getOverrideValue(instance, localId, propertyPath) {
    for (const oid of instance.propertyOverrides || []) {
        const ov = byId.get(oid.__id__ ?? oid);
        if (!ov) continue;
        const target = byId.get(ov.targetInfo?.__id__ ?? ov.targetInfo);
        const localIds = target?.localID || [];
        if (ov.propertyPath?.join('.') === propertyPath.join('.') && localIds.includes(localId)) {
            return ov.value;
        }
    }
    return undefined;
}

function getItemSpriteSize(instance) {
    const size = getOverrideValue(instance, ITEM_SPRITE_TRANSFORM_LOCAL_ID, ['_contentSize']);
    if (size?.width && size?.height) {
        return { width: size.width, height: size.height };
    }
    return { ...PREFAB_ITEM_SPRITE_SIZE };
}

function getNodeScale(instance, localId, prefabDefault) {
    const scale = getOverrideValue(instance, localId, ['_lscale']);
    return {
        x: scale?.x ?? prefabDefault.x,
        y: scale?.y ?? prefabDefault.y,
    };
}

function getVisualSize(contentSize, nodeScale) {
    return {
        width: contentSize.width * nodeScale.x,
        height: contentSize.height * nodeScale.y,
    };
}

function getVisualGlowRatio(spriteSize, spriteScale, glowSize, glowScale) {
    const spriteVisual = getVisualSize(spriteSize, spriteScale);
    const glowVisual = getVisualSize(glowSize, glowScale);
    return {
        width: glowVisual.width / spriteVisual.width,
        height: glowVisual.height / spriteVisual.height,
        spriteVisual,
        glowVisual,
    };
}

function getGlowScaleFromReference(instances) {
    for (const { instance } of instances) {
        const itemName = getOverrideValue(instance, ROOT_LOCAL_ID, ['_name']);
        if (itemName !== REFERENCE_ITEM_NAME) continue;

        const sprite = getItemSpriteSize(instance);
        const glow = getOverrideValue(instance, GLOW_TRANSFORM_LOCAL_ID, ['_contentSize']);
        if (!glow?.width || !glow?.height) {
            console.error(`Reference ${REFERENCE_ITEM_NAME} is missing SpriteGlow _contentSize override`);
            process.exit(1);
        }

        const spriteNodeScale = getNodeScale(instance, ITEM_SPRITE_NODE_LOCAL_ID, PREFAB_ITEM_SPRITE_NODE_SCALE);
        const glowNodeScale = getNodeScale(instance, GLOW_NODE_LOCAL_ID, PREFAB_GLOW_NODE_SCALE);
        const visualRatio = getVisualGlowRatio(sprite, spriteNodeScale, glow, glowNodeScale);

        return {
            visualRatio,
            reference: {
                itemName,
                sprite,
                glow,
                spriteNodeScale,
                glowNodeScale,
            },
        };
    }

    console.error(`Reference instance ${REFERENCE_ITEM_NAME} not found`);
    process.exit(1);
}

function computeGlowContentSize(spriteSize, spriteNodeScale, glowNodeScale, visualRatio) {
    return {
        width: round1(
            (spriteSize.width * spriteNodeScale.x * visualRatio.width) / glowNodeScale.x,
        ),
        height: round1(
            (spriteSize.height * spriteNodeScale.y * visualRatio.height) / glowNodeScale.y,
        ),
    };
}

const byId = new Map();
for (let i = 0; i < scene.length; i++) {
    const obj = scene[i];
    if (!obj) continue;
    const id = obj.__id__ !== undefined ? obj.__id__ : i;
    byId.set(id, obj);
}

const slotsNode = scene.find((o) => o._name === 'Slots-layer' && o._id === SLOTS_LAYER_ID);
if (!slotsNode) {
    console.error('Slots-layer not found');
    process.exit(1);
}

let maxId = Math.max(...scene.map((o, i) => (o?.__id__ !== undefined ? o.__id__ : i)));
const instances = [];
for (const cid of slotsNode._children || []) {
    const child = byId.get(cid.__id__ ?? cid);
    if (!child?._prefab) continue;
    const prefabInfoId = child._prefab.__id__ ?? child._prefab;
    const prefabInfo = byId.get(prefabInfoId);
    if (!prefabInfo || prefabInfo.asset?.__uuid__ !== DRAGGABLE_PREFAB_UUID) continue;
    const instanceId = prefabInfo.instance?.__id__ ?? prefabInfo.instance;
    const instance = byId.get(instanceId);
    if (!instance) continue;
    instances.push({ instance });
}

function ensureOverride(instance, byId, scene, localId, propertyPath, value, maxIdRef) {
    let existing = null;
    for (const oid of instance.propertyOverrides || []) {
        const ov = byId.get(oid.__id__ ?? oid);
        if (!ov) continue;
        const target = byId.get(ov.targetInfo?.__id__ ?? ov.targetInfo);
        const localIds = target?.localID || [];
        if (ov.propertyPath?.join('.') === propertyPath.join('.') && localIds.includes(localId)) {
            existing = ov;
            break;
        }
    }

    if (existing) {
        existing.value = value;
        return maxIdRef.value;
    }

    maxIdRef.value += 1;
    const targetInfoId = maxIdRef.value;
    maxIdRef.value += 1;
    const overrideId = maxIdRef.value;
    scene.push({
        __type__: 'cc.TargetInfo',
        __id__: targetInfoId,
        localID: [localId],
    });
    scene.push({
        __type__: 'CCPropertyOverrideInfo',
        __id__: overrideId,
        targetInfo: { __id__: targetInfoId },
        propertyPath,
        value,
    });
    instance.propertyOverrides.push({ __id__: overrideId });
    return maxIdRef.value;
}

const glowReference = getGlowScaleFromReference(instances);
const { visualRatio, reference } = glowReference;
console.log(
    `Reference ${REFERENCE_ITEM_NAME}: ` +
        `sprite ${reference.sprite.width}x${reference.sprite.height} @${reference.spriteNodeScale.x}/${reference.spriteNodeScale.y}, ` +
        `glow ${reference.glow.width}x${reference.glow.height} @${reference.glowNodeScale.x}/${reference.glowNodeScale.y}, ` +
        `visual ratio ${round1(visualRatio.width)}x / ${round1(visualRatio.height)}y`,
);

const maxIdRef = { value: maxId };
const report = [];
for (const { instance } of instances) {
    const itemName = getOverrideValue(instance, ROOT_LOCAL_ID, ['_name']);
    if (!itemName) {
        report.push({ itemName: '?', status: 'no_name' });
        continue;
    }

    const glowAsset = glowMap[itemName];
    if (!glowAsset) {
        report.push({ itemName, status: 'missing_glow_file' });
        continue;
    }

    const spriteSize = getItemSpriteSize(instance);
    const spriteNodeScale = getNodeScale(instance, ITEM_SPRITE_NODE_LOCAL_ID, PREFAB_ITEM_SPRITE_NODE_SCALE);
    const glowNodeScale = getNodeScale(instance, GLOW_NODE_LOCAL_ID, PREFAB_GLOW_NODE_SCALE);
    const glowSize = computeGlowContentSize(spriteSize, spriteNodeScale, glowNodeScale, visualRatio);
    const appliedVisual = getVisualGlowRatio(spriteSize, spriteNodeScale, glowSize, glowNodeScale);

    ensureOverride(
        instance,
        byId,
        scene,
        GLOW_SPRITE_LOCAL_ID,
        ['_spriteFrame'],
        { __uuid__: glowAsset.uuid, __expectedType__: 'cc.SpriteFrame' },
        maxIdRef,
    );
    ensureOverride(
        instance,
        byId,
        scene,
        GLOW_TRANSFORM_LOCAL_ID,
        ['_contentSize'],
        {
            __type__: 'cc.Size',
            width: glowSize.width,
            height: glowSize.height,
        },
        maxIdRef,
    );
    ensureOverride(instance, byId, scene, GLOW_NODE_LOCAL_ID, ['_active'], false, maxIdRef);
    ensureOverride(instance, byId, scene, GLOW_SPRITE_LOCAL_ID, ['_sizeMode'], GLOW_SIZE_MODE_CUSTOM, maxIdRef);
    ensureOverride(instance, byId, scene, GLOW_SPRITE_LOCAL_ID, ['_type'], 0, maxIdRef);
    ensureOverride(instance, byId, scene, GLOW_SPRITE_LOCAL_ID, ['_isTrimmedMode'], false, maxIdRef);
    report.push({
        itemName,
        status: 'ok',
        sprite: `${spriteSize.width}x${spriteSize.height} @${round1(spriteNodeScale.x)}/${round1(spriteNodeScale.y)}`,
        glow: `${glowSize.width}x${glowSize.height} @${round1(glowNodeScale.x)}/${round1(glowNodeScale.y)}`,
        visualRatio: `${round1(appliedVisual.width)}x/${round1(appliedVisual.height)}y`,
    });
}

maxId = maxIdRef.value;

fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
console.log(`Instances: ${instances.length}`);
console.log(JSON.stringify(report, null, 2));
