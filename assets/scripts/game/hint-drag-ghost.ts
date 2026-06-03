import { Color, Material, Node, Sprite, SpriteFrame, tween, Tween, UITransform, Vec3, Vec4 } from 'cc';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const MAX_GLOW_LAYERS = 5;

/** Копия предмета под пальцем: оригинальный спрайт + жёлтое свечение сзади */
export class HintDragGhost {
    localOffset: Vec3 = new Vec3(35, -130, 0);
    /** Слоёв жёлтого свечения (2–5). Больше = мягче «размытие» */
    glowLayerCount: number = 5;
    /** Внешний размер ореола: 1 = как предмет, 1.35 = на 35% шире */
    glowOuterScale: number = 1.38;
    glowColor: Color = new Color(255, 214, 72, 150);
    /** true = мягкий ореол (LightCircle + additive), false = чёткие силуэты (SpriteSolidFill) */
    useSoftGlow: boolean = true;
    /** Задаётся из ManualController.hintGhostSoftGlowSpriteFrame; иначе fallback LightCircle */
    glowSoftSpriteFrame: SpriteFrame | null = null;
    /** materials/materialLight-001 — аддитивное свечение */
    glowAdditiveMaterial: Material | null = null;
    /** materials/SpriteSolidFill — только если useSoftGlow = false */
    glowMaterial: Material | null = null;

    private _root: Node | null = null;
    private _glowSprites: Sprite[] = [];
    private _itemSprite: Sprite | null = null;
    private _glowMaterialInstances: (Material | null)[] = [];
    private _glowAdditiveInstances: (Material | null)[] = [];
    private _fadeToken = 0;
    private _hostHand: Node | null = null;
    private _followVisualNode: Node | null = null;
    private _attachedParent: Node | null = null;
    private _sharedAdditiveMaterial: Material | null = null;
    private readonly _offsetWorld = new Vec3();
    private readonly _fillColorVec4 = new Vec4();

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

        for (let i = 0; i < MAX_GLOW_LAYERS; i++) {
            const glowNode = new Node(`Glow${i}`);
            glowNode.setParent(root, false);
            glowNode.setSiblingIndex(i);
            glowNode.layer = hostHand.layer;
            const glowTransform = glowNode.addComponent(UITransform);
            glowTransform.setAnchorPoint(0.5, 0.5);
            const glowSprite = glowNode.addComponent(Sprite);
            glowSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this._glowSprites.push(glowSprite);
        }

        const itemNode = new Node('Item');
        itemNode.setParent(root, false);
        itemNode.setSiblingIndex(MAX_GLOW_LAYERS);
        itemNode.layer = hostHand.layer;
        const itemTransform = itemNode.addComponent(UITransform);
        itemTransform.setAnchorPoint(0.5, 0.5);
        const itemSprite = itemNode.addComponent(Sprite);
        itemSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._itemSprite = itemSprite;

        this._root = root;
        this._attachBehindHand(hostHand);
        root.active = false;
    }

    syncFollow(): void {
        this._applyTransform();
    }

    showFromClone(hostHand: Node, item: DraggableItem, clone: Node): void {
        if (!hostHand?.isValid || !clone?.isValid) return;

        const sourceSprite = this._getSpriteFromNode(clone) ?? item.spriteComp;
        if (!sourceSprite?.spriteFrame) return;

        this.ensure(hostHand);
        if (!this._root?.isValid || !this._itemSprite) return;

        this._followVisualNode = clone;
        this._attachBehindHand(hostHand);
        this._setupVisual(sourceSprite);
        this._applyTransform();
        this._setRenderOrderBelowHand(hostHand);
        this._root.active = true;
    }

    /**
     * Ghost в RoomContainer (на Canvas он выше по дереву, чем UiHand) —
     * иначе копия оказывается поверх спрайта пальца на той же ноде/дочерних слоях.
     */
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

        const ghostSprites = this._collectFadeSprites();
        for (const sprite of ghostSprites) {
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

    private _setupVisual(sourceSprite: Sprite): void {
        if (!this._root?.isValid || !this._itemSprite) return;

        const spriteNode = sourceSprite.node;
        const sourceTransform = spriteNode.getComponent(UITransform);
        const width = sourceTransform?.contentSize.width ?? 100;
        const height = sourceTransform?.contentSize.height ?? 100;

        const itemTransform = this._itemSprite.node.getComponent(UITransform)!;
        itemTransform.setContentSize(width, height);
        this._itemSprite.spriteFrame = sourceSprite.spriteFrame;
        this._itemSprite.customMaterial = null;
        this._itemSprite.color = sourceSprite.color.clone();
        this._itemSprite.node.active = true;

        const layerCount = Math.min(MAX_GLOW_LAYERS, Math.max(2, Math.round(this.glowLayerCount)));
        const outerScale = Math.max(1, this.glowOuterScale);
        const useSoft = this.useSoftGlow && !!this.glowSoftSpriteFrame && !!this.glowAdditiveMaterial;

        for (let i = 0; i < MAX_GLOW_LAYERS; i++) {
            const sprite = this._glowSprites[i];
            if (!sprite?.isValid) continue;

            const layerActive = i < layerCount;
            sprite.node.active = layerActive;
            if (!layerActive) continue;

            const outerT = layerCount <= 1 ? 0 : i / (layerCount - 1);
            const scaleMul = 1 + (outerScale - 1) * (1 - outerT);
            const alpha = Math.round(this.glowColor.a * (0.15 + 0.85 * (1 - outerT)));

            const glowTransform = sprite.node.getComponent(UITransform)!;
            if (useSoft) {
                const softSize = Math.max(width, height) * scaleMul;
                glowTransform.setContentSize(softSize, softSize);
                this._applySoftGlowMaterial(sprite, i, alpha);
            } else {
                glowTransform.setContentSize(width * scaleMul, height * scaleMul);
                sprite.spriteFrame = sourceSprite.spriteFrame;
                this._applySolidFillMaterial(sprite, i, alpha);
            }
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
        if (!this._root?.isValid) return;
        this._root.active = false;
    }

    destroy(): void {
        this._fadeToken++;
        this._hostHand = null;
        this._followVisualNode = null;
        if (this._root?.isValid) {
            this._root.destroy();
        }
        this._root = null;
        this._itemSprite = null;
        this._glowSprites.length = 0;
        this._glowMaterialInstances.length = 0;
        this._glowAdditiveInstances.length = 0;
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

    private _applySoftGlowMaterial(sprite: Sprite, layerIndex: number, layerAlpha: number): void {
        const frame = this.glowSoftSpriteFrame;
        const template = this.glowAdditiveMaterial;
        if (!frame || !template?.isValid) {
            sprite.customMaterial = null;
            sprite.color = new Color(this.glowColor.r, this.glowColor.g, this.glowColor.b, layerAlpha);
            return;
        }

        if (!this._sharedAdditiveMaterial?.isValid) {
            this._sharedAdditiveMaterial = new Material();
            this._sharedAdditiveMaterial.copy(template);
        }

        sprite.spriteFrame = frame;
        sprite.customMaterial = this._sharedAdditiveMaterial;
        this._glowAdditiveInstances[layerIndex] = this._sharedAdditiveMaterial;
        sprite.color = new Color(this.glowColor.r, this.glowColor.g, this.glowColor.b, layerAlpha);
    }

    private _applySolidFillMaterial(sprite: Sprite, layerIndex: number, layerAlpha: number): void {
        const template = this.glowMaterial;
        if (!template?.isValid || !template.effectAsset) {
            this._applyBuiltinGlowFallback(sprite, layerAlpha);
            return;
        }

        let instance = this._glowMaterialInstances[layerIndex];
        if (!instance?.isValid) {
            instance = new Material();
            instance.copy(template);
            this._glowMaterialInstances[layerIndex] = instance;
        }

        sprite.customMaterial = instance;
        sprite.color = new Color(255, 255, 255, layerAlpha);

        try {
            this._fillColorVec4.set(
                this.glowColor.r / 255,
                this.glowColor.g / 255,
                this.glowColor.b / 255,
                1,
            );
            instance.setProperty('fillColor', this._fillColorVec4);
            instance.setProperty('fillOpacity', 1.0);
        } catch (e) {
            console.warn('[HintDragGhost] SpriteSolidFill setProperty failed', e);
            this._applyBuiltinGlowFallback(sprite, layerAlpha);
        }
    }

    private _applyBuiltinGlowFallback(sprite: Sprite, layerAlpha: number): void {
        sprite.customMaterial = null;
        sprite.color = new Color(this.glowColor.r, this.glowColor.g, this.glowColor.b, layerAlpha);
    }

    private _getSpriteFromNode(node: Node): Sprite | null {
        const spriteNode = node.getChildByName('Sprite') ?? node;
        return spriteNode.getComponent(Sprite);
    }
}
