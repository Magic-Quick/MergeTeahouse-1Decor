import { Color, Material, Node, Size, Sprite, SpriteFrame, tween, Tween, UITransform, Vec3 } from 'cc';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const MAX_GLOW_LAYERS = 20;

interface GhostVisualSnapshot {
    itemSpriteFrame: SpriteFrame;
    itemColor: Color;
    itemWidth: number;
    itemHeight: number;
    glowSpriteFrame: SpriteFrame | null;
    glowSizeMode: number;
    glowContentSize: Size;
    glowLocalScale: Vec3;
}

/** Копия предмета под пальцем: спрайт предмета + glow-текстура сзади (как SpriteGlow в DraggableItem). */
export class HintDragGhost {
    localOffset: Vec3 = new Vec3(35, -130, 0);
    glowColor: Color = new Color(255, 214, 72, 150);
    /** Сколько одинаковых glow-слоёв наложить (2 = «удвоение» яркости) */
    glowLayerCount: number = 2;
    /** true = круглая текстура BlurCircle вместо glow-текстуры предмета */
    useSoftGlow: boolean = false;
    glowSoftSpriteFrame: SpriteFrame | null = null;
    glowAdditiveMaterial: Material | null = null;

    private _root: Node | null = null;
    private _glowSprites: Sprite[] = [];
    private _itemSprite: Sprite | null = null;
    private _sharedAdditiveMaterial: Material | null = null;
    private _fadeToken = 0;
    private _hostHand: Node | null = null;
    private _followVisualNode: Node | null = null;
    private _attachedParent: Node | null = null;
    private _cachedVisual: GhostVisualSnapshot | null = null;
    private readonly _offsetWorld = new Vec3();

    isShowing(): boolean {
        return !!this._root?.isValid && this._root.active;
    }

    ensure(hostHand: Node): void {
        if (!hostHand?.isValid) return;
        if (this._root?.isValid) {
            this._attachBehindHand(hostHand);
            return;
        }

        const root = new Node('HintItemGhost');
        const rootTransform = root.addComponent(UITransform);
        rootTransform.setAnchorPoint(0.5, 0.5);
        root.layer = hostHand.layer;

        const itemNode = new Node('Item');
        itemNode.setParent(root, false);
        itemNode.layer = hostHand.layer;
        const itemTransform = itemNode.addComponent(UITransform);
        itemTransform.setAnchorPoint(0.5, 0.5);
        const itemSprite = itemNode.addComponent(Sprite);
        itemSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._itemSprite = itemSprite;

        this._root = root;
        this._ensureGlowPool(MAX_GLOW_LAYERS, hostHand.layer);
        this._attachBehindHand(hostHand);
        root.active = false;
    }

    private _ensureGlowPool(count: number, layer: number): void {
        if (!this._root?.isValid) return;

        const target = Math.min(MAX_GLOW_LAYERS, Math.max(1, Math.round(count)));
        while (this._glowSprites.length < target) {
            const i = this._glowSprites.length;
            const glowNode = new Node(`Glow${i}`);
            glowNode.setParent(this._root, false);
            glowNode.layer = layer;
            const glowTransform = glowNode.addComponent(UITransform);
            glowTransform.setAnchorPoint(0.5, 0.5);
            const glowSprite = glowNode.addComponent(Sprite);
            glowSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this._glowSprites.push(glowSprite);
        }

        const itemNode = this._itemSprite?.node;
        if (itemNode?.isValid) {
            itemNode.setSiblingIndex(this._glowSprites.length);
        }
        for (let i = 0; i < this._glowSprites.length; i++) {
            this._glowSprites[i].node.setSiblingIndex(i);
        }
    }

    syncFollow(): void {
        this._applyTransform();
    }

    showFromClone(hostHand: Node, item: DraggableItem, clone: Node): void {
        if (!hostHand?.isValid || !clone?.isValid) return;

        const sourceSprite = this._getItemSpriteFromNode(clone) ?? item.spriteComp;
        if (!sourceSprite?.spriteFrame) return;

        this.ensure(hostHand);
        if (!this._root?.isValid || !this._itemSprite) return;

        this._ensureGlowPool(this._resolveGlowLayerCount(), hostHand.layer);
        this._followVisualNode = clone;
        this._attachBehindHand(hostHand);
        this._cachedVisual = this._captureVisualSnapshot(sourceSprite, clone, item);
        this._setupVisualFromSnapshot(this._cachedVisual);
        this._applyTransform();
        this._setRenderOrderBelowHand(hostHand);
        this._root.active = true;
    }

    /** Обновляет только материал/цвет glow — без пересчёта геометрии с inactive-клона. */
    refreshMaterials(): void {
        if (!this._root?.isValid || !this._root.active || !this._cachedVisual) return;

        const layerCount = this._resolveGlowLayerCount();
        const snapshot = this._cachedVisual;

        for (let i = 0; i < this._glowSprites.length; i++) {
            const glowSprite = this._glowSprites[i];
            if (!glowSprite?.isValid) continue;

            const layerActive = i < layerCount && !!snapshot.glowSpriteFrame;
            glowSprite.node.active = layerActive;
            glowSprite.enabled = layerActive;
            if (!layerActive) continue;

            this._applyGlowMaterial(glowSprite);
            this._applyGlowColor(glowSprite);
        }
    }

    private _attachBehindHand(hostHand: Node): void {
        if (!this._root?.isValid || !hostHand.isValid) return;

        const roomContainer = this._findAncestorNamed(hostHand, 'RoomContainer');
        const parent = roomContainer ?? hostHand.parent ?? hostHand;

        if (this._attachedParent === parent && this._root.parent === parent) {
            this._hostHand = hostHand;
            return;
        }

        this._root.setParent(parent, false);
        this._attachedParent = parent;

        const handIndex = hostHand.getSiblingIndex();
        const targetIndex = Math.max(0, handIndex);
        this._root.setSiblingIndex(targetIndex);
        if (hostHand.parent === parent && hostHand.getSiblingIndex() <= this._root.getSiblingIndex()) {
            hostHand.setSiblingIndex(this._root.getSiblingIndex() + 1);
        }

        this._hostHand = hostHand;
    }

    private _findAncestorNamed(start: Node, name: string): Node | null {
        let cursor: Node | null = start.parent;
        while (cursor) {
            if (cursor.name === name) {
                return cursor;
            }
            cursor = cursor.parent;
        }
        return null;
    }

    private _setRenderOrderBelowHand(hostHand: Node): void {
        const handSprite = hostHand.getComponent(Sprite);
        if (handSprite && 'priority' in handSprite) {
            (handSprite as Sprite & { priority: number }).priority = 10;
        }

        for (const sprite of this._collectFadeSprites()) {
            if ('priority' in sprite) {
                (sprite as Sprite & { priority: number }).priority = 0;
            }
        }
    }

    private _applyTransform(): void {
        if (!this._root?.isValid || !this._hostHand?.isValid) return;

        const hand = this._hostHand;
        Vec3.transformQuat(this._offsetWorld, this.localOffset, hand.worldRotation);
        this._offsetWorld.x *= hand.worldScale.x;
        this._offsetWorld.y *= hand.worldScale.y;
        this._offsetWorld.z *= hand.worldScale.z;

        const handPos = hand.worldPosition;
        this._root.setWorldPosition(
            handPos.x + this._offsetWorld.x,
            handPos.y + this._offsetWorld.y,
            handPos.z + this._offsetWorld.z,
        );

        const visual = this._followVisualNode;
        if (!visual?.isValid) return;

        this._root.setWorldRotation(visual.worldRotation);
        this._root.setWorldScale(visual.worldScale);
    }

    private _resolveGlowLayerCount(): number {
        return Math.min(MAX_GLOW_LAYERS, Math.max(1, Math.round(this.glowLayerCount)));
    }

    private _applyGlowColor(sprite: Sprite): void {
        sprite.color = new Color(this.glowColor.r, this.glowColor.g, this.glowColor.b, this.glowColor.a);
    }

    private _applyGlowMaterial(sprite: Sprite): void {
        const source = this.glowAdditiveMaterial;
        if (!source?.isValid) {
            sprite.customMaterial = null;
            return;
        }

        if (!this._sharedAdditiveMaterial?.isValid) {
            this._sharedAdditiveMaterial = new Material();
        }
        this._sharedAdditiveMaterial.copy(source);
        sprite.customMaterial = this._sharedAdditiveMaterial;
    }

    private _captureVisualSnapshot(
        sourceSprite: Sprite,
        sourceRoot: Node,
        item: DraggableItem,
    ): GhostVisualSnapshot {
        const sourceTransform = sourceSprite.node.getComponent(UITransform);
        const sourceGlow = this._resolveSourceGlow(sourceRoot, item);
        const glowTransform = sourceGlow?.node.getComponent(UITransform);

        return {
            itemSpriteFrame: sourceSprite.spriteFrame!,
            itemColor: sourceSprite.color.clone(),
            itemWidth: sourceTransform?.contentSize.width ?? 100,
            itemHeight: sourceTransform?.contentSize.height ?? 100,
            glowSpriteFrame: sourceGlow?.spriteFrame ?? null,
            glowSizeMode: sourceGlow?.sizeMode ?? Sprite.SizeMode.CUSTOM,
            glowContentSize: glowTransform?.contentSize.clone() ?? new Size(100, 100),
            glowLocalScale: sourceGlow?.node.scale.clone() ?? new Vec3(1, 1, 1),
        };
    }

    private _resolveSourceGlow(sourceRoot: Node, item: DraggableItem): Sprite | null {
        return sourceRoot.getChildByName('SpriteGlow')?.getComponent(Sprite) ?? item.getGlowSprite();
    }

    private _setupVisualFromSnapshot(snapshot: GhostVisualSnapshot): void {
        if (!this._root?.isValid || !this._itemSprite) return;

        const itemTransform = this._itemSprite.node.getComponent(UITransform)!;
        itemTransform.setContentSize(snapshot.itemWidth, snapshot.itemHeight);
        this._itemSprite.spriteFrame = snapshot.itemSpriteFrame;
        this._itemSprite.customMaterial = null;
        this._itemSprite.color = snapshot.itemColor.clone();
        this._itemSprite.node.active = true;

        const layerCount = this._resolveGlowLayerCount();

        for (let i = 0; i < this._glowSprites.length; i++) {
            const glowSprite = this._glowSprites[i];
            if (!glowSprite?.isValid) continue;

            const layerActive = i < layerCount;
            glowSprite.node.active = layerActive;
            glowSprite.enabled = layerActive;
            if (!layerActive) continue;

            const glowTransform = glowSprite.node.getComponent(UITransform)!;
            glowSprite.node.setPosition(0, 0, 0);

            if (this.useSoftGlow && this.glowSoftSpriteFrame) {
                const softSize = Math.max(snapshot.itemWidth, snapshot.itemHeight) * 1.35;
                glowTransform.setContentSize(softSize, softSize);
                glowSprite.node.setScale(1, 1, 1);
                glowSprite.spriteFrame = this.glowSoftSpriteFrame;
                this._applyGlowMaterial(glowSprite);
                this._applyGlowColor(glowSprite);
                continue;
            }

            if (snapshot.glowSpriteFrame) {
                glowTransform.setContentSize(snapshot.glowContentSize);
                glowSprite.node.setScale(snapshot.glowLocalScale);
                glowSprite.spriteFrame = snapshot.glowSpriteFrame;
                glowSprite.sizeMode = snapshot.glowSizeMode;
                this._applyGlowMaterial(glowSprite);
                this._applyGlowColor(glowSprite);
                continue;
            }

            glowSprite.node.active = false;
            glowSprite.enabled = false;
        }
    }

    fadeOut(duration: number, onComplete?: () => void): void {
        if (!this._root?.isValid || !this._root.active) {
            onComplete?.();
            return;
        }

        const token = ++this._fadeToken;
        const sprites = this._collectFadeSprites();
        if (sprites.length === 0) {
            this.hideImmediate();
            onComplete?.();
            return;
        }

        let pending = sprites.length;
        for (const sprite of sprites) {
            const startColor = sprite.color.clone();
            const fadeState = { a: startColor.a };
            Tween.stopAllByTarget(sprite);
            tween(fadeState)
                .to(duration, { a: 0 }, {
                    easing: 'quadOut',
                    onUpdate: () => {
                        if (!sprite.isValid) return;
                        const color = startColor.clone();
                        color.a = Math.max(0, Math.round(fadeState.a));
                        sprite.color = color;
                    },
                })
                .call(() => {
                    pending -= 1;
                    if (pending === 0 && token === this._fadeToken) {
                        this.hideImmediate();
                        onComplete?.();
                    }
                })
                .start();
        }
    }

    hideImmediate(): void {
        this._fadeToken++;
        this._hostHand = null;
        this._followVisualNode = null;
        this._cachedVisual = null;
        if (!this._root?.isValid) return;
        this._root.active = false;
    }

    destroy(): void {
        this._fadeToken++;
        this._hostHand = null;
        this._followVisualNode = null;
        this._cachedVisual = null;
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._root = null;
        this._itemSprite = null;
        this._glowSprites.length = 0;
        this._sharedAdditiveMaterial = null;
        this._attachedParent = null;
    }

    private _collectFadeSprites(): Sprite[] {
        const sprites: Sprite[] = [];
        if (this._itemSprite?.isValid && this._itemSprite.node.active) {
            sprites.push(this._itemSprite);
        }
        for (const sprite of this._glowSprites) {
            if (sprite?.isValid && sprite.node.active) {
                sprites.push(sprite);
            }
        }
        return sprites;
    }

    private _getItemSpriteFromNode(node: Node): Sprite | null {
        const spriteNode = node.getChildByName('Sprite') ?? node;
        return spriteNode.getComponent(Sprite);
    }
}
