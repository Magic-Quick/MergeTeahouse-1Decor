import { Color, Material, Node, Sprite, SpriteFrame, tween, Tween, UITransform, Vec2, Vec3, Vec4 } from 'cc';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const MAX_GLOW_LAYERS = 5;

const GLOW_OFFSET_DIRS: ReadonlyArray<Readonly<{ x: number; y: number }>> = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];

/** Копия предмета под пальцем: оригинальный спрайт + жёлтое свечение сзади */
export class HintDragGhost {
    localOffset: Vec3 = new Vec3(35, -130, 0);
    /** Слоёв жёлтого свечения (2–5). Больше = мягче «размытие» */
    glowLayerCount: number = 5;
    /** Внешний размер ореола: 1 = как предмет, 1.35 = на 35% шире */
    glowOuterScale: number = 1.38;
    glowColor: Color = new Color(255, 214, 72, 150);
    /** true = круглая текстура (BlurCircle). false = контур предмета + размытие (SpriteContourGlow) */
    useSoftGlow: boolean = false;
    /** Задаётся из ManualController.hintGhostSoftGlowSpriteFrame; иначе fallback LightCircle */
    glowSoftSpriteFrame: SpriteFrame | null = null;
    /** materials/materialLight-001 — только для круглой текстуры */
    glowAdditiveMaterial: Material | null = null;
    /** materials/SpriteContourGlow — свечение по форме с размытием */
    glowContourMaterial: Material | null = null;
    /** Радиус размытия в UV (0.02–0.08) */
    glowRadius: number = 0.035;
    /** Мягкость falloff кольцевых сэмплов (0–1) */
    glowSoftness: number = 0.65;
    glowIntensity: number = 1.0;
    /** materials/SpriteSolidFill — запасной вариант без шейдера */
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
    private readonly _glowColorVec4 = new Vec4();
    private readonly _glowTextureSize = new Vec2(256, 256);
    private _glowContentScaleX = 1;
    private _glowContentScaleY = 1;
    private _glowRadiusTexels = 8;

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

        const outerScale = Math.max(1, this.glowOuterScale);
        const useCircle = this.useSoftGlow && !!this.glowSoftSpriteFrame && !!this.glowAdditiveMaterial;
        const useContour = !useCircle && !!this.glowContourMaterial?.isValid;
        const layerCount = useContour
            ? Math.min(MAX_GLOW_LAYERS, Math.max(1, Math.round(this.glowLayerCount)))
            : Math.min(MAX_GLOW_LAYERS, Math.max(2, Math.round(this.glowLayerCount)));

        const glowPadding = useContour ? this._calcGlowPadding(width, height, outerScale) : 0;
        const expandedWidth = width + glowPadding * 2;
        const expandedHeight = height + glowPadding * 2;
        if (useContour) {
            this._glowContentScaleX = width / expandedWidth;
            this._glowContentScaleY = height / expandedHeight;
            this._updateGlowTextureMetrics(sourceSprite.spriteFrame, width, height);
        }

        for (let i = 0; i < MAX_GLOW_LAYERS; i++) {
            const sprite = this._glowSprites[i];
            if (!sprite?.isValid) continue;

            const layerActive = i < layerCount;
            sprite.node.active = layerActive;
            sprite.enabled = layerActive;
            if (!layerActive) continue;

            const glowTransform = sprite.node.getComponent(UITransform)!;

            if (useContour) {
                sprite.node.setScale(1, 1, 1);
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                sprite.spriteFrame = sourceSprite.spriteFrame;

                if (i === 0) {
                    glowTransform.setContentSize(expandedWidth, expandedHeight);
                    sprite.node.setPosition(0, 0, 0);
                    this._applyContourGlowMaterial(sprite, i);
                    continue;
                }

                const offsetIndex = i - 1;
                const dir = GLOW_OFFSET_DIRS[offsetIndex % GLOW_OFFSET_DIRS.length];
                const ring = Math.floor(offsetIndex / GLOW_OFFSET_DIRS.length) + 1;
                const spreadPx = Math.max(1.5, glowPadding * 0.22 * ring);
                glowTransform.setContentSize(width, height);
                sprite.node.setPosition(dir.x * spreadPx, dir.y * spreadPx, 0);
                const alpha = Math.round(this.glowColor.a * (0.18 + 0.42 * (1 - offsetIndex / Math.max(1, layerCount - 1))));
                this._applySolidFillMaterial(sprite, i, alpha);
                continue;
            }

            sprite.node.setPosition(0, 0, 0);
            sprite.node.setScale(1, 1, 1);

            const outerT = layerCount <= 1 ? 0 : i / (layerCount - 1);
            const scaleMul = 1 + (outerScale - 1) * (1 - outerT);
            const alpha = Math.round(this.glowColor.a * (0.15 + 0.85 * (1 - outerT)));

            if (useCircle) {
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

    private _createContourMaterialInstance(template: Material): Material {
        const instance = new Material();
        instance.copy(template);
        return instance;
    }

    private _calcGlowPadding(width: number, height: number, outerScale: number): number {
        const maxDim = Math.max(width, height);
        const spread = Math.max(0, outerScale - 1);
        const fromScale = spread * 0.5 * maxDim;
        const fromRadius = this.glowRadius * maxDim;
        return Math.max(8, Math.ceil(fromScale + fromRadius));
    }

    private _updateGlowTextureMetrics(spriteFrame: SpriteFrame, width: number, height: number): void {
        const texture = spriteFrame.texture;
        const texW = texture?.width ?? width;
        const texH = texture?.height ?? height;
        this._glowTextureSize.set(texW, texH);
        this._glowRadiusTexels = Math.max(2, this.glowRadius * Math.max(texW, texH));
    }

    private _applyMaterialProperties(material: Material): void {
        this._glowColorVec4.set(
            this.glowColor.r / 255,
            this.glowColor.g / 255,
            this.glowColor.b / 255,
            this.glowColor.a / 255,
        );
        material.setProperty('glowColor', this._glowColorVec4);
        material.setProperty('textureSize', this._glowTextureSize);
        material.setProperty('glowRadius', this._glowRadiusTexels);
        material.setProperty('glowIntensity', this.glowIntensity);
        material.setProperty('glowSoftness', this.glowSoftness);
        material.setProperty('contentScaleX', this._glowContentScaleX);
        material.setProperty('contentScaleY', this._glowContentScaleY);
    }

    private _applyContourGlowMaterial(sprite: Sprite, layerIndex: number): void {
        const template = this.glowContourMaterial;
        if (!template?.isValid) {
            this._applyBuiltinGlowFallback(sprite, this.glowColor.a);
            return;
        }

        const instance = this._createContourMaterialInstance(template);
        try {
            this._applyMaterialProperties(instance);
        } catch (e) {
            console.warn('[HintDragGhost] SpriteContourGlow setProperty failed', e);
            this._applyBuiltinGlowFallback(sprite, this.glowColor.a);
            return;
        }

        sprite.customMaterial = instance;
        this._glowMaterialInstances[layerIndex] = instance;
        sprite.color = new Color(255, 255, 255, 255);
        sprite.markForUpdateRenderData();
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
