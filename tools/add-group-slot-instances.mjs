/**
 * Добавляет DraggableItem-инстансы в Main.scene из assets/sprites/furnituregreen/Groups.
 * Пары: {Name}_Group.png + {Name}_Group_Glow.png (glow опционален).
 *
 * node tools/add-group-slot-instances.mjs
 * node tools/add-group-slot-instances.mjs --sync-glow
 */
import fs from 'fs';
import path from 'path';

const scenePath = 'assets/Main.scene';
const groupsDir = 'assets/sprites/furnituregreen/Groups';

const DRAGGABLE_PREFAB_UUID = '893d15b9-f49a-4109-aa0d-fcfbcd4595ee';
const SLOTS_LAYER_ID = '98eYzYwDlFAKGxoYtoLt8h';
const ROOT_LOCAL_ID = '10Yuvo4m1HJ7TFEqtHHheX';
const ROOT_UI_LOCAL_ID = 'aeT6Q5oopGAoldc+4UDUT8';
const DRAGGABLE_LOCAL_ID = '536SvBE/lF/IJyRXfv6skz';
const ITEM_SPRITE_LOCAL_ID = '11AB1Qs3lAc5EcyOEMAOAi';
const ITEM_SPRITE_NODE_LOCAL_ID = '24nDhoWyJNOLD2NS4p68tm';
const ITEM_SPRITE_TRANSFORM_LOCAL_ID = '6fnJ0vCMdLlLvWQ3FNv0SP';
const GLOW_SPRITE_LOCAL_ID = 'b1/sf30nBMZaS7F18+IL+l';
const GLOW_TRANSFORM_LOCAL_ID = '50/L1g29lCnrRp9Z71wVtD';
const GLOW_NODE_LOCAL_ID = 'c1bWg57GxL/L4CQrFvzYAi';
const PREFAB_ITEM_SPRITE_SIZE = { width: 234, height: 174 };
const PREFAB_ITEM_SPRITE_NODE_SCALE = { x: 1, y: 1 };
const PREFAB_GLOW_NODE_SCALE = { x: 1.295, y: 1.295 };
const GLOW_SIZE_MODE_CUSTOM = 0;
const REFERENCE_ITEM_NAME = 'DiningSet';

function round1(n) {
    return Math.round(n * 10) / 10;
}

function vec3(x, y, z = 0) {
    return { __type__: 'cc.Vec3', x, y, z };
}

function quat() {
    return { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };
}

function size(width, height) {
    return { __type__: 'cc.Size', width: round1(width), height: round1(height) };
}

function spriteFrame(uuid) {
    return { __uuid__: uuid, __expectedType__: 'cc.SpriteFrame' };
}

function loadSpriteFrame(metaPath) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const frame = meta.subMetas?.f9941;
    const userData = frame?.userData ?? {};
    return {
        uuid: frame?.uuid ?? `${meta.uuid}@f9941`,
        rawWidth: userData.rawWidth ?? userData.width ?? 100,
        rawHeight: userData.rawHeight ?? userData.height ?? 100,
    };
}

function scanGroups() {
    const groups = new Map();
    for (const file of fs.readdirSync(groupsDir)) {
        if (!file.endsWith('.png.meta')) continue;
        const base = file.replace(/\.png\.meta$/, '');
        if (!base.endsWith('_Group')) continue;
        if (/_Group_.+/.test(base)) continue;

        const instanceName = base;
        const mainPath = path.join(groupsDir, `${base}.png.meta`);
        const glowPath = path.join(groupsDir, `${base}_Glow.png.meta`);
        const entry = {
            instanceName,
            baseName: base.replace(/_Group$/, ''),
            main: loadSpriteFrame(mainPath),
            glow: fs.existsSync(glowPath) ? loadSpriteFrame(glowPath) : null,
        };
        groups.set(instanceName, entry);
    }
    return [...groups.values()].sort((a, b) => a.instanceName.localeCompare(b.instanceName));
}

function getOverrideValue(instance, byId, localId, propertyPath) {
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

function getItemSpriteSize(instance, byId) {
    const sizeValue = getOverrideValue(instance, byId, ITEM_SPRITE_TRANSFORM_LOCAL_ID, ['_contentSize']);
    if (sizeValue?.width && sizeValue?.height) {
        return { width: sizeValue.width, height: sizeValue.height };
    }
    return { ...PREFAB_ITEM_SPRITE_SIZE };
}

function getNodeScale(instance, byId, localId, prefabDefault) {
    const scale = getOverrideValue(instance, byId, localId, ['_lscale']);
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
    };
}

function computeGlowContentSize(spriteSize, spriteNodeScale, glowNodeScale, visualRatio) {
    return {
        width: round1((spriteSize.width * spriteNodeScale.x * visualRatio.width) / glowNodeScale.x),
        height: round1((spriteSize.height * spriteNodeScale.y * visualRatio.height) / glowNodeScale.y),
    };
}

function getGlowReference(instances, byId) {
    for (const { instance } of instances) {
        const itemName = getOverrideValue(instance, byId, ROOT_LOCAL_ID, ['_name']);
        if (itemName !== REFERENCE_ITEM_NAME) continue;

        const sprite = getItemSpriteSize(instance, byId);
        const glow = getOverrideValue(instance, byId, GLOW_TRANSFORM_LOCAL_ID, ['_contentSize']);
        if (!glow?.width || !glow?.height) break;

        const spriteNodeScale = getNodeScale(instance, byId, ITEM_SPRITE_NODE_LOCAL_ID, PREFAB_ITEM_SPRITE_NODE_SCALE);
        const glowNodeScale = getNodeScale(instance, byId, GLOW_NODE_LOCAL_ID, PREFAB_GLOW_NODE_SCALE);
        return getVisualGlowRatio(sprite, spriteNodeScale, glow, glowNodeScale);
    }

    return { width: 1.1, height: 1.1 };
}

function getExistingNames(scene, byId) {
    const names = new Set();
    for (const obj of scene) {
        if (obj?.__type__ !== 'CCPropertyOverrideInfo') continue;
        if (obj.propertyPath?.[0] !== '_name') continue;
        if (typeof obj.value === 'string') names.add(obj.value);
    }
    return names;
}

function getBaseItemPosition(instances, byId, baseName) {
    for (const { instance } of instances) {
        const itemName = getOverrideValue(instance, byId, ROOT_LOCAL_ID, ['_name']);
        if (itemName !== baseName) continue;
        const pos = getOverrideValue(instance, byId, ROOT_LOCAL_ID, ['_lpos']);
        if (pos) return { x: pos.x, y: pos.y };
    }
    return { x: 0, y: -120 };
}

function makeFileId(instanceName) {
    return `grp_${Buffer.from(instanceName).toString('base64').replace(/[+/=]/g, '').slice(0, 24)}`;
}

function buildGlowOverrideSpecs(ctx) {
    if (!ctx.glowUuid) return [];
    return [
        [GLOW_SPRITE_LOCAL_ID, ['_spriteFrame'], spriteFrame(ctx.glowUuid)],
        [GLOW_NODE_LOCAL_ID, ['_lpos'], vec3(0, 0, 0)],
        [GLOW_NODE_LOCAL_ID, ['_active'], false],
        [GLOW_SPRITE_LOCAL_ID, ['_sizeMode'], GLOW_SIZE_MODE_CUSTOM],
        [GLOW_SPRITE_LOCAL_ID, ['_type'], 0],
        [GLOW_SPRITE_LOCAL_ID, ['_isTrimmedMode'], false],
        [GLOW_TRANSFORM_LOCAL_ID, ['_contentSize'], size(ctx.glowW, ctx.glowH)],
        [GLOW_NODE_LOCAL_ID, ['_lscale'], vec3(ctx.glowScale.x, ctx.glowScale.y, ctx.glowScale.z ?? 1.222)],
    ];
}

function buildOverrideSpecs(ctx) {
    const specs = [
        [ROOT_LOCAL_ID, ['_lpos'], vec3(ctx.pos.x, ctx.pos.y, 0)],
        [ROOT_LOCAL_ID, ['_name'], ctx.instanceName],
        [ROOT_LOCAL_ID, ['_lrot'], quat()],
        [ROOT_LOCAL_ID, ['_euler'], vec3(0, 0, 0)],
        [ROOT_LOCAL_ID, ['_lscale'], vec3(1.172, 1.172, 1.172)],
        [DRAGGABLE_LOCAL_ID, ['snapRadius'], 120],
        [ITEM_SPRITE_TRANSFORM_LOCAL_ID, ['_contentSize'], size(ctx.rawW, ctx.rawH)],
        [ITEM_SPRITE_LOCAL_ID, ['_spriteFrame'], spriteFrame(ctx.mainUuid)],
        [ITEM_SPRITE_LOCAL_ID, ['_color'], { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 }],
        [ITEM_SPRITE_LOCAL_ID, ['_sizeMode'], 2],
        [ITEM_SPRITE_LOCAL_ID, ['_isTrimmedMode'], false],
        [ITEM_SPRITE_NODE_LOCAL_ID, ['_lpos'], vec3(0, 0, 0)],
        [ITEM_SPRITE_NODE_LOCAL_ID, ['_lscale'], vec3(1, 1, 1)],
        [ITEM_SPRITE_NODE_LOCAL_ID, ['_lrot'], quat()],
        [ITEM_SPRITE_NODE_LOCAL_ID, ['_euler'], vec3(0, 0, 0)],
        [ROOT_UI_LOCAL_ID, ['_contentSize'], size(ctx.rawW, ctx.rawH)],
    ];

    specs.push(...buildGlowOverrideSpecs(ctx));

    return specs;
}

function instanceHasGlow(instance, byId) {
    return !!getOverrideValue(instance, byId, GLOW_SPRITE_LOCAL_ID, ['_spriteFrame']);
}

function findInstanceByName(existingInstances, byId, instanceName) {
    for (const entry of existingInstances) {
        const name = getOverrideValue(entry.instance, byId, ROOT_LOCAL_ID, ['_name']);
        if (name === instanceName) return entry;
    }
    return null;
}

function appendGlowOverrides(scene, instance, ctx) {
    const overrideIds = [];
    for (const [localId, propertyPath, value] of buildGlowOverrideSpecs(ctx)) {
        const targetInfoId = pushSceneObject(scene, {
            __type__: 'cc.TargetInfo',
            localID: [localId],
        });
        const overrideId = pushSceneObject(scene, {
            __type__: 'CCPropertyOverrideInfo',
            targetInfo: { __id__: targetInfoId },
            propertyPath,
            value,
        });
        overrideIds.push(overrideId);
    }
    instance.propertyOverrides.push(...overrideIds.map((id) => ({ __id__: id })));
    return overrideIds;
}

function pushSceneObject(scene, obj) {
    const id = scene.length;
    obj.__id__ = id;
    scene.push(obj);
    return id;
}

function appendInstance(scene, slotsLayerIndex, dragCtrlIndex, scenePrefabInfoIndex, ctx) {
    const overrideIds = [];
    const specs = buildOverrideSpecs(ctx);

    for (const [localId, propertyPath, value] of specs) {
        const targetInfoId = pushSceneObject(scene, {
            __type__: 'cc.TargetInfo',
            localID: [localId],
        });
        const overrideId = pushSceneObject(scene, {
            __type__: 'CCPropertyOverrideInfo',
            targetInfo: { __id__: targetInfoId },
            propertyPath,
            value,
        });
        overrideIds.push(overrideId);
    }

    const prefabInfoId = pushSceneObject(scene, {
        __type__: 'cc.PrefabInfo',
        root: null,
        asset: { __uuid__: DRAGGABLE_PREFAB_UUID, __expectedType__: 'cc.Prefab' },
        fileId: ROOT_LOCAL_ID,
        instance: null,
        targetOverrides: null,
    });

    const prefabInstanceId = pushSceneObject(scene, {
        __type__: 'cc.PrefabInstance',
        fileId: makeFileId(ctx.instanceName),
        prefabRootNode: null,
        mountedChildren: [],
        mountedComponents: [],
        propertyOverrides: overrideIds.map((id) => ({ __id__: id })),
        removedComponents: [],
    });

    const rootNodeId = pushSceneObject(scene, {
        __type__: 'cc.Node',
        _objFlags: 0,
        _parent: { __id__: slotsLayerIndex },
        _prefab: { __id__: prefabInfoId },
        __editorExtras__: {},
    });

    scene[prefabInfoId].root = { __id__: rootNodeId };
    scene[prefabInfoId].instance = { __id__: prefabInstanceId };

    const slotsLayer = scene[slotsLayerIndex];
    slotsLayer._children.push({ __id__: rootNodeId });

    const dragCtrl = scene[dragCtrlIndex];
    const slotEntryId = pushSceneObject(scene, {
        __type__: 'DraggableItemSlot',
        item: null,
        spawnScale: 1,
    });
    dragCtrl.itemSlots.push({ __id__: slotEntryId });

    const slotIndex = dragCtrl.itemSlots.length - 1;
    const targetInfoId = pushSceneObject(scene, {
        __type__: 'cc.TargetInfo',
        localID: [DRAGGABLE_LOCAL_ID],
    });
    const targetOverrideId = pushSceneObject(scene, {
        __type__: 'cc.TargetOverrideInfo',
        source: { __id__: dragCtrlIndex },
        sourceInfo: null,
        propertyPath: ['itemSlots', String(slotIndex), 'item'],
        target: { __id__: rootNodeId },
        targetInfo: { __id__: targetInfoId },
    });

    const scenePrefabInfo = scene[scenePrefabInfoIndex];
    scenePrefabInfo.targetOverrides.push({ __id__: targetOverrideId });
    if (!Array.isArray(scenePrefabInfo.nestedPrefabInstanceRoots)) {
        scenePrefabInfo.nestedPrefabInstanceRoots = [];
    }
    scenePrefabInfo.nestedPrefabInstanceRoots.push({ __id__: rootNodeId });

    return {
        rootNodeId,
        slotIndex,
        instanceName: ctx.instanceName,
    };
}

function repairNestedPrefabRoots(scene, slotsLayerIndex, scenePrefabInfoIndex) {
    const slotsLayer = scene[slotsLayerIndex];
    const scenePrefabInfo = scene[scenePrefabInfoIndex];
    if (!Array.isArray(scenePrefabInfo.nestedPrefabInstanceRoots)) {
        scenePrefabInfo.nestedPrefabInstanceRoots = [];
    }

    const registered = new Set(
        scenePrefabInfo.nestedPrefabInstanceRoots.map((ref) => ref.__id__ ?? ref),
    );
    const repaired = [];

    for (const childRef of slotsLayer._children || []) {
        const rootNodeId = childRef.__id__ ?? childRef;
        const child = scene[rootNodeId];
        if (!child?._prefab) continue;
        if (registered.has(rootNodeId)) continue;
        scenePrefabInfo.nestedPrefabInstanceRoots.push({ __id__: rootNodeId });
        registered.add(rootNodeId);
        repaired.push(rootNodeId);
    }

    return repaired;
}

const repairOnly = process.argv.includes('--repair');
const syncGlowOnly = process.argv.includes('--sync-glow');
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));

const byId = new Map();
for (let i = 0; i < scene.length; i++) {
    const obj = scene[i];
    if (!obj) continue;
    byId.set(obj.__id__ !== undefined ? obj.__id__ : i, obj);
}

const slotsLayerIndex = scene.findIndex((o) => o?._name === 'Slots-layer' && o._id === SLOTS_LAYER_ID);
const dragCtrlIndex = scene.findIndex((o) => o && Array.isArray(o.itemSlots));
const scenePrefabInfoIndex = scene.findIndex(
    (o) => o?.__type__ === 'cc.PrefabInfo' && o.fileId === 'd4207955-c9e5-426a-8fd3-806de6530d01',
);

if (slotsLayerIndex < 0 || dragCtrlIndex < 0 || scenePrefabInfoIndex < 0) {
    console.error('Scene anchors not found', { slotsLayerIndex, dragCtrlIndex, scenePrefabInfoIndex });
    process.exit(1);
}

const existingInstances = [];
for (const cid of scene[slotsLayerIndex]._children || []) {
    const child = byId.get(cid.__id__ ?? cid);
    if (!child?._prefab) continue;
    const prefabInfo = byId.get(child._prefab.__id__ ?? child._prefab);
    if (!prefabInfo || prefabInfo.asset?.__uuid__ !== DRAGGABLE_PREFAB_UUID) continue;
    const instance = byId.get(prefabInfo.instance?.__id__ ?? prefabInfo.instance);
    if (!instance) continue;
    existingInstances.push({ instance, rootNodeId: child.__id__ ?? cid.__id__ ?? cid });
}

const visualRatio = getGlowReference(existingInstances, byId);
const existingNames = getExistingNames(scene, byId);
const groups = scanGroups();
const report = [];

if (repairOnly) {
    const repaired = repairNestedPrefabRoots(scene, slotsLayerIndex, scenePrefabInfoIndex);
    fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
    console.log(`Repaired nestedPrefabInstanceRoots: ${repaired.length}`);
    console.log(repaired);
    process.exit(0);
}

if (syncGlowOnly) {
    for (const group of groups) {
        if (!group.glow) {
            report.push({ instanceName: group.instanceName, status: 'skipped_no_glow_file' });
            continue;
        }

        const entry = findInstanceByName(existingInstances, byId, group.instanceName);
        if (!entry) {
            report.push({ instanceName: group.instanceName, status: 'skipped_not_in_scene' });
            continue;
        }

        if (instanceHasGlow(entry.instance, byId)) {
            report.push({ instanceName: group.instanceName, status: 'skipped_has_glow' });
            continue;
        }

        const spriteSize = getItemSpriteSize(entry.instance, byId);
        const spriteNodeScale = getNodeScale(entry.instance, byId, ITEM_SPRITE_NODE_LOCAL_ID, PREFAB_ITEM_SPRITE_NODE_SCALE);
        const glowNodeScale = { ...PREFAB_GLOW_NODE_SCALE };
        const glowSize = computeGlowContentSize(spriteSize, spriteNodeScale, glowNodeScale, visualRatio);

        appendGlowOverrides(scene, entry.instance, {
            glowUuid: group.glow.uuid,
            glowW: glowSize.width,
            glowH: glowSize.height,
            glowScale: glowNodeScale,
        });

        report.push({
            instanceName: group.instanceName,
            status: 'glow_synced',
            glow: `${glowSize.width}x${glowSize.height}`,
            glowUuid: group.glow.uuid,
        });
    }

    fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
    fs.writeFileSync('tools/add-group-slot-instances.report.json', `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Groups scanned: ${groups.length}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
}

for (const group of groups) {
    if (existingNames.has(group.instanceName)) {
        report.push({ instanceName: group.instanceName, status: 'skipped_exists' });
        continue;
    }

    const basePos = getBaseItemPosition(existingInstances, byId, group.baseName);
    const pos = { x: round1(basePos.x + 40), y: round1(basePos.y - 40) };
    const spriteSize = { width: group.main.rawWidth, height: group.main.rawHeight };
    const spriteNodeScale = { ...PREFAB_ITEM_SPRITE_NODE_SCALE };
    const glowNodeScale = { ...PREFAB_GLOW_NODE_SCALE };
    const glowSize = group.glow
        ? computeGlowContentSize(spriteSize, spriteNodeScale, glowNodeScale, visualRatio)
        : null;

    const created = appendInstance(scene, slotsLayerIndex, dragCtrlIndex, scenePrefabInfoIndex, {
        instanceName: group.instanceName,
        pos,
        rawW: group.main.rawWidth,
        rawH: group.main.rawHeight,
        mainUuid: group.main.uuid,
        glowUuid: group.glow?.uuid ?? null,
        glowW: glowSize?.width ?? 0,
        glowH: glowSize?.height ?? 0,
        glowScale: glowNodeScale,
    });

    report.push({
        instanceName: group.instanceName,
        status: 'added',
        slotIndex: created.slotIndex,
        rootNodeId: created.rootNodeId,
        sprite: `${group.main.rawWidth}x${group.main.rawHeight}`,
        glow: glowSize ? `${glowSize.width}x${glowSize.height}` : 'none',
        pos,
    });
}

fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
fs.writeFileSync('tools/add-group-slot-instances.report.json', `${JSON.stringify(report, null, 2)}\n`);

console.log(`Groups scanned: ${groups.length}`);
console.log(JSON.stringify(report, null, 2));
