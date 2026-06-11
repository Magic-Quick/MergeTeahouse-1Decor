/**
 * Синхронизирует DragDropController.itemSlots с активными DraggableItem в Slots-layer.
 * node tools/sync-item-slots.mjs
 * node tools/sync-item-slots.mjs --dry-run
 */
import fs from 'fs';

const scenePath = 'assets/Main.scene';
const dryRun = process.argv.includes('--dry-run');

const DRAGGABLE_PREFAB_UUID = '893d15b9-f49a-4109-aa0d-fcfbcd4595ee';
const SLOTS_LAYER_ID = '98eYzYwDlFAKGxoYtoLt8h';
const ROOT_LOCAL_ID = '10Yuvo4m1HJ7TFEqtHHheX';
const DRAGGABLE_LOCAL_ID = '536SvBE/lF/IJyRXfv6skz';
const SCENE_PREFAB_FILE_ID = 'd4207955-c9e5-426a-8fd3-806de6530d01';

const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const byId = new Map();
for (let i = 0; i < scene.length; i++) {
    const obj = scene[i];
    if (!obj) continue;
    byId.set(obj.__id__ !== undefined ? obj.__id__ : i, obj);
}

function getNodeName(nodeId) {
    const node = byId.get(nodeId);
    if (!node) return `?#${nodeId}`;
    if (node._name) return node._name;

    const prefabInfo = byId.get(node._prefab?.__id__ ?? node._prefab);
    if (!prefabInfo) return `Node#${nodeId}`;
    const instance = byId.get(prefabInfo.instance?.__id__ ?? prefabInfo.instance);
    if (!instance) return `Prefab#${nodeId}`;

    for (const oid of instance.propertyOverrides || []) {
        const ov = byId.get(oid.__id__ ?? oid);
        if (ov?.propertyPath?.[0] !== '_name') continue;
        return ov.value;
    }
    return `Prefab#${nodeId}`;
}

function isDraggablePrefabNode(nodeId) {
    const node = byId.get(nodeId);
    if (!node?._prefab) return false;
    const prefabInfo = byId.get(node._prefab.__id__ ?? node._prefab);
    return prefabInfo?.asset?.__uuid__ === DRAGGABLE_PREFAB_UUID;
}

function getPrefabInstance(nodeId) {
    const node = byId.get(nodeId);
    if (!node?._prefab) return null;
    const prefabInfo = byId.get(node._prefab.__id__ ?? node._prefab);
    return byId.get(prefabInfo?.instance?.__id__ ?? prefabInfo?.instance) ?? null;
}

function getRootActiveOverride(nodeId) {
    const instance = getPrefabInstance(nodeId);
    if (!instance) return undefined;

    for (const overrideRef of instance.propertyOverrides || []) {
        const override = byId.get(overrideRef.__id__ ?? overrideRef);
        if (!override || override.propertyPath?.[0] !== '_active') continue;
        const targetInfo = byId.get(override.targetInfo?.__id__ ?? override.targetInfo);
        if (!targetInfo?.localID?.includes(ROOT_LOCAL_ID)) continue;
        return override.value;
    }
    return undefined;
}

function isNodeActive(nodeId) {
    const node = byId.get(nodeId);
    if (!node) return false;

    const rootActiveOverride = getRootActiveOverride(nodeId);
    if (rootActiveOverride === false) return false;
    if (node._active === false && rootActiveOverride !== true) return false;

    let parentId = node._parent?.__id__ ?? node._parent;
    while (parentId != null) {
        const parent = byId.get(parentId);
        if (!parent) break;
        if (parent._active === false) return false;
        parentId = parent._parent?.__id__ ?? parent._parent;
    }
    return true;
}

function pushSceneObject(obj) {
    const id = scene.length;
    obj.__id__ = id;
    scene.push(obj);
    return id;
}

const slotsLayerIndex = scene.findIndex((o) => o?._name === 'Slots-layer' && o._id === SLOTS_LAYER_ID);
const dragCtrlIndex = scene.findIndex((o) => o && Array.isArray(o.itemSlots));
const scenePrefabInfoIndex = scene.findIndex(
    (o) => o?.__type__ === 'cc.PrefabInfo' && o.fileId === SCENE_PREFAB_FILE_ID,
);

if (slotsLayerIndex < 0 || dragCtrlIndex < 0 || scenePrefabInfoIndex < 0) {
    console.error('Scene anchors not found', { slotsLayerIndex, dragCtrlIndex, scenePrefabInfoIndex });
    process.exit(1);
}

const slotsLayer = scene[slotsLayerIndex];
const dragCtrl = scene[dragCtrlIndex];
const scenePrefabInfo = scene[scenePrefabInfoIndex];

const activeSlotItems = [];
const inactiveSlotItems = [];
const allSlotChildren = [];

for (const childRef of slotsLayer._children || []) {
    const nodeId = childRef.__id__ ?? childRef;
    const node = byId.get(nodeId);
    if (!node) continue;
    allSlotChildren.push(nodeId);

    if (!isDraggablePrefabNode(nodeId)) continue;

    const entry = { nodeId, name: getNodeName(nodeId), active: isNodeActive(nodeId) };
    if (entry.active) {
        activeSlotItems.push(entry);
    } else {
        inactiveSlotItems.push(entry);
    }
}

const currentSlotTargets = new Map();
const itemSlotOverrides = [];

for (const overrideRef of scenePrefabInfo.targetOverrides || []) {
    const override = byId.get(overrideRef.__id__ ?? overrideRef);
    if (!override) continue;
    const path = override.propertyPath || [];
    if (path[0] !== 'itemSlots' || path[2] !== 'item') continue;
    const slotIndex = Number(path[1]);
    const targetId = override.target?.__id__ ?? override.target;
    currentSlotTargets.set(slotIndex, { targetId, overrideId: override.__id__ ?? overrideRef.__id__ ?? overrideRef, override });
    itemSlotOverrides.push({ slotIndex, targetId, override });
}

const currentTargetsByNode = new Map();
for (const { slotIndex, targetId } of itemSlotOverrides) {
    currentTargetsByNode.set(targetId, slotIndex);
}

const spawnScaleByNode = new Map();
for (let i = 0; i < dragCtrl.itemSlots.length; i++) {
    const slotRef = dragCtrl.itemSlots[i];
    const slot = byId.get(slotRef.__id__ ?? slotRef);
    const targetId = currentSlotTargets.get(i)?.targetId;
    if (targetId != null && slot?.spawnScale != null) {
        spawnScaleByNode.set(targetId, slot.spawnScale);
    }
}

const toRemove = itemSlotOverrides.filter(({ targetId }) => !activeSlotItems.some((e) => e.nodeId === targetId));
const toAdd = activeSlotItems.filter((e) => !currentTargetsByNode.has(e.nodeId));

const activeByNodeId = new Map(activeSlotItems.map((e) => [e.nodeId, e]));
const finalItems = [];

for (const childRef of slotsLayer._children || []) {
    const nodeId = childRef.__id__ ?? childRef;
    const entry = activeByNodeId.get(nodeId);
    if (entry) finalItems.push(entry);
}

console.log('Slots-layer children:', allSlotChildren.length);
console.log('Active DraggableItem:', activeSlotItems.length);
console.log('Inactive DraggableItem:', inactiveSlotItems.map((e) => `${e.name} (#${e.nodeId})`).join(', ') || 'none');
console.log('Current itemSlots:', dragCtrl.itemSlots.length);
console.log('Remove from itemSlots:', toRemove.map((e) => `${getNodeName(e.targetId)} [${e.slotIndex}]`).join(', ') || 'none');
console.log('Add to itemSlots:', toAdd.map((e) => `${e.name} (#${e.nodeId})`).join(', ') || 'none');
console.log('Final itemSlots:', finalItems.length);

if (dryRun) {
    console.log('\nDry run — scene not modified.');
    process.exit(0);
}

const currentItemSlotOverrideCount = (scenePrefabInfo.targetOverrides || []).filter((ref) =>
    isItemSlotItemOverride(byId.get(ref.__id__ ?? ref)),
).length;

const slotsAlreadyMatch = toRemove.length === 0
    && toAdd.length === 0
    && finalItems.length === dragCtrl.itemSlots.length
    && finalItems.every((e, i) => currentSlotTargets.get(i)?.targetId === e.nodeId);

if (slotsAlreadyMatch && currentItemSlotOverrideCount === finalItems.length) {
    console.log('Already in sync.');
    process.exit(0);
}

if (slotsAlreadyMatch) {
    console.log(`Rebuilding stale targetOverrides (${currentItemSlotOverrideCount} -> ${finalItems.length})`);
}

function isItemSlotItemOverride(override) {
    if (!override || override.__type__ !== 'cc.TargetOverrideInfo') return false;
    const path = override.propertyPath || [];
    if (path[0] !== 'itemSlots' || path[2] !== 'item') return false;
    const sourceId = override.source?.__id__ ?? override.source;
    return sourceId === dragCtrlIndex;
}

scenePrefabInfo.targetOverrides = (scenePrefabInfo.targetOverrides || []).filter((ref) => {
    const override = byId.get(ref.__id__ ?? ref);
    return !isItemSlotItemOverride(override);
});

const oldSlotIds = dragCtrl.itemSlots.map((ref) => ref.__id__ ?? ref);
const newSlotRefs = [];
const newOverrideRefs = [];

for (const item of finalItems) {
    const existingIndex = currentTargetsByNode.get(item.nodeId);
    let slotId;
    if (existingIndex != null && oldSlotIds[existingIndex] != null) {
        slotId = oldSlotIds[existingIndex];
    } else {
        slotId = pushSceneObject({
            __type__: 'DraggableItemSlot',
            item: null,
            spawnScale: spawnScaleByNode.get(item.nodeId) ?? 1,
        });
    }

    const slot = byId.get(slotId);
    if (slot && spawnScaleByNode.has(item.nodeId)) {
        slot.spawnScale = spawnScaleByNode.get(item.nodeId);
    }

    newSlotRefs.push({ __id__: slotId });

    const targetInfoId = pushSceneObject({
        __type__: 'cc.TargetInfo',
        localID: [DRAGGABLE_LOCAL_ID],
    });
    const overrideId = pushSceneObject({
        __type__: 'cc.TargetOverrideInfo',
        source: { __id__: dragCtrlIndex },
        sourceInfo: null,
        propertyPath: ['itemSlots', String(newSlotRefs.length - 1), 'item'],
        target: { __id__: item.nodeId },
        targetInfo: { __id__: targetInfoId },
    });
    newOverrideRefs.push({ __id__: overrideId });
}

dragCtrl.itemSlots = newSlotRefs;
scenePrefabInfo.targetOverrides.push(...newOverrideRefs);

const usedSlotIds = new Set(newSlotRefs.map((r) => r.__id__));
const orphanSlotIds = oldSlotIds.filter((id) => !usedSlotIds.has(id));

fs.writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
fs.writeFileSync(
    'tools/sync-item-slots.report.json',
    JSON.stringify(
        {
            active: activeSlotItems.map((e) => ({ name: e.name, nodeId: e.nodeId })),
            inactive: inactiveSlotItems.map((e) => ({ name: e.name, nodeId: e.nodeId })),
            removed: toRemove.map((e) => ({ name: getNodeName(e.targetId), nodeId: e.targetId, slotIndex: e.slotIndex })),
            added: toAdd.map((e) => ({ name: e.name, nodeId: e.nodeId })),
            finalCount: finalItems.length,
            orphanSlotIds,
        },
        null,
        2,
    ) + '\n',
);

console.log(`Synced itemSlots: ${finalItems.length} (removed ${toRemove.length}, added ${toAdd.length})`);
