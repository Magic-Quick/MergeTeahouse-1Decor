import { _decorator, Animation, assetManager, Color, Component, Material, Node, ParticleSystem2D, Sprite, tween, Tween, UITransform, Vec3 } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import {
    EVT_CHEST_TAPPED,
    EVT_GAME_COMPLETE,
    EVT_ITEM_DRAG_START,
    EVT_ITEM_PLACED,
    EVT_ITEM_SPAWNED,
} from 'db://assets/scripts/common/events';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';
import { HintDragGhost } from 'db://assets/scripts/game/hint-drag-ghost';

const { ccclass, property } = _decorator;

/** assets/materials/SpriteSolidFill.mtl */
const HINT_GHOST_GLOW_MATERIAL_UUID = 'd5f9b2e3-0c4e-5f7b-9a2d-3e6f8b0c1d4e';

interface ItemSpawnedEvent {
    type: string;
    item: DraggableItem;
    clone: Node;
}

interface ItemPlacedEvent {
    type: string;
    item: DraggableItem;
}

interface SpawnedHintTarget {
    item: DraggableItem;
    clone: Node;
}

/**
 * Tutorial hints:
 * 1. Tap the box at start and again when all spawned items are placed but the game continues.
 * 2. Drag the first spawned item to its hologram if the player waits too long.
 * 3. Idle placement hint for any unplaced spawned item.
 */
@ccclass('ManualController')
export class ManualController extends Component {
    @property({ type: Node, tooltip: 'Нода руки с Animation-клипом HandTap' })
    uiHand: Node | null = null;

    @property({ type: Node, tooltip: 'Нода коробки, куда будет указывать первая подсказка' })
    boxNode: Node | null = null;

    @property({ tooltip: 'Задержка перед первой подсказкой на коробку, сек' })
    boxHintDelay: number = 3;

    @property({ tooltip: 'Повтор подсказки на коробку, сек' })
    boxHintRepeatDelay: number = 3;

    @property({ tooltip: 'Задержка перед подсказкой перетаскивания первого предмета, сек' })
    dragHintDelay: number = 3;

    @property({ tooltip: 'Повтор подсказки перетаскивания, сек' })
    dragHintRepeatDelay: number = 4;

    @property({ tooltip: 'Длительность движения руки от предмета к голограмме, сек' })
    dragHintMoveDuration: number = 0.8;

    @property({ tooltip: 'Если столько секунд не было установки предмета, показать подсказку к случайному вытащенному предмету' })
    placementIdleDelay: number = 5;

    @property({ tooltip: 'Повтор idle-подсказки установки, сек' })
    placementIdleRepeatDelay: number = 5;

    @property({ tooltip: 'Длительность fade-исчезновения эмиттера руки, сек' })
    handParticleFadeDelay: number = 0.8;

    @property({ tooltip: 'Локальное смещение копии предмета под пальцем (от UiHand)' })
    hintGhostLocalOffset: Vec3 = new Vec3(35, -130, 0);

    @property({ type: Material, tooltip: 'Материал равномерной заливки (SpriteSolidFill). Если пусто — подгрузится автоматически.' })
    hintGhostGlowMaterial: Material | null = null;

    @property({ tooltip: 'Цвет заливки свечения (RGB)' })
    hintGhostGlowColor: Color = new Color(255, 214, 72, 255);

    @property({ tooltip: 'Прозрачность свечения (0–255)' })
    hintGhostGlowAlpha: number = 150;

    @property({ tooltip: 'Размер жёлтого ореола: 1 = как предмет, 1.4 = на 40% крупнее. Главная настройка размера glow.' })
    hintGhostGlowOuterScale: number = 1.38;

    @property({ tooltip: 'Слоёв ореола (2–5). Больше = мягче размытие. 1 слой почти без размытия.' })
    hintGhostBlurLayers: number = 5;

    private _unsubs: Array<() => void> = [];
    private _gameCompleted: boolean = false;
    private _dragStepDone: boolean = false;
    private _firstItem: DraggableItem | null = null;
    private _firstClone: Node | null = null;
    private _spawnedHintTargets: SpawnedHintTarget[] = [];
    private _handParticles: ParticleSystem2D[] = [];
    private _handParticleNode: Node | null = null;
    private _handParticleEmissionRates = new Map<ParticleSystem2D, number>();
    private _handParticleDefaultColors = new Map<ParticleSystem2D, Color>();
    private _handSprite: Sprite | null = null;
    private _handSpriteDefaultColor: Color | null = null;
    private _handTapOnComplete: (() => void) | null = null;
    private _handParticleFadeToken = 0;
    private readonly _hintDragGhost = new HintDragGhost();
    /** Клон из коробки, скрытый на время drag-подсказки (под пальцем показывается HintItemGhost) */
    private _hintGhostHiddenClone: Node | null = null;
    private _hintGhostVisualItem: DraggableItem | null = null;
    private readonly _uiHandDefaultLocalPos = new Vec3();
    private readonly _uiHandDefaultLocalEuler = new Vec3();
    private readonly _uiHandDefaultLocalScale = new Vec3(1, 1, 1);

    onLoad(): void {
        this._syncHintGhostSettings();
        this._cacheHandParts();
        this._hideHand(true);
        this._unsubs.push(
            GlobalEventBus.subscribe(EVT_CHEST_TAPPED, () => this._onChestTapped()),
            GlobalEventBus.subscribe<ItemSpawnedEvent>(EVT_ITEM_SPAWNED, (event) => this._onItemSpawned(event)),
            GlobalEventBus.subscribe(EVT_ITEM_DRAG_START, () => this._onItemDragStart()),
            GlobalEventBus.subscribe<ItemPlacedEvent>(EVT_ITEM_PLACED, (event) => this._onItemPlaced(event)),
            GlobalEventBus.subscribe(EVT_GAME_COMPLETE, () => this._onGameComplete()),
        );
    }

    start(): void {
        this._ensureHintGhostMaterial();
        this._scheduleBoxHint(this.boxHintDelay);
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._handParticleFadeToken++;
        this._handTapOnComplete = null;
        const anim = this._getHandAnimation();
        anim?.off(Animation.EventType.FINISHED, this._onHandTapAnimFinished, this);
        if (this.uiHand?.isValid) {
            Tween.stopAllByTarget(this.uiHand);
        }
        this._cleanupHandParticlesOnDestroy();
        this._hintDragGhost.destroy();
        for (const unsub of this._unsubs) unsub();
        this._unsubs.length = 0;
    }

    private _onChestTapped(): void {
        this.unschedule(this._showBoxHint);
        this._hideHand();
    }

    private _onGameComplete(): void {
        this._gameCompleted = true;
        this.unschedule(this._showBoxHint);
        this.unschedule(this._showPlacementIdleHint);
        this._hideHand();
    }

    private _onItemSpawned(event: ItemSpawnedEvent): void {
        if (!event.item || !event.clone) return;

        this.unschedule(this._showBoxHint);
        this._hideHand();

        this._spawnedHintTargets.push({ item: event.item, clone: event.clone });
        if (this._dragStepDone) {
            this._schedulePlacementIdleHint(this.placementIdleDelay);
        }

        if (this._dragStepDone || this._firstClone) return;

        this._firstItem = event.item;
        this._firstClone = event.clone;
        this._scheduleDragHint(this.dragHintDelay);
    }

    private _onItemDragStart(): void {
        if (this._dragStepDone) return;
        this._dragStepDone = true;
        this.unschedule(this._showDragHint);
        this._restoreHintClone();
        this._hideHand();
        this._schedulePlacementIdleHint(this.placementIdleDelay);
    }

    private _onItemPlaced(event: ItemPlacedEvent): void {
        this._spawnedHintTargets = this._spawnedHintTargets.filter(({ item, clone }) => {
            if (event.item && item === event.item) return false;
            return !!clone && clone.isValid && clone.active && !item.isPlaced;
        });
        if (event.item && this._firstItem === event.item) {
            this._firstItem = null;
            this._firstClone = null;
            this.unschedule(this._showDragHint);
        }

        this.unschedule(this._showPlacementIdleHint);
        this._hideHand();

        if (this._gameCompleted) return;

        if (this._getAvailablePlacementTargets().length > 0) {
            if (this._dragStepDone) {
                this._schedulePlacementIdleHint(this.placementIdleDelay);
            }
            return;
        }

        // Все вытащенные предметы установлены — снова подсказываем нажать на коробку
        this._scheduleBoxHint(this.boxHintDelay);
    }

    private _scheduleBoxHint(delay: number): void {
        if (this._gameCompleted) return;
        this.unschedule(this._showBoxHint);
        this.scheduleOnce(this._showBoxHint, delay);
    }

    private _showBoxHint(): void {
        if (this._gameCompleted || !this.uiHand?.isValid || !this.boxNode?.isValid) return;
        if (this._getAvailablePlacementTargets().length > 0) return;

        this._prepareHandAt(this.boxNode.worldPosition);
        this._playHandTap(this._onBoxHandTapCycleEnd);
    }

    private _onBoxHandTapCycleEnd = (): void => {
        this._fadeHandParticlesAfterHint();
        this._scheduleBoxHint(this.boxHintRepeatDelay + this.handParticleFadeDelay);
    };

    private _scheduleDragHint(delay: number): void {
        if (this._dragStepDone) return;
        this.unschedule(this._showDragHint);
        this.scheduleOnce(this._showDragHint, delay);
    }

    private _showDragHint(): void {
        if (this._dragStepDone || !this.uiHand?.isValid || !this._firstClone || !this._firstItem) return;
        if (!this._firstClone.isValid || !this._firstClone.active || this._firstItem.isPlaced) return;

        this._playDragPathHint(this._firstClone, this._firstItem, () => {
            this._scheduleDragHint(this.dragHintRepeatDelay);
        });
    }

    private _schedulePlacementIdleHint(delay: number): void {
        if (!this._dragStepDone) return;
        this.unschedule(this._showPlacementIdleHint);
        this.scheduleOnce(this._showPlacementIdleHint, delay);
    }

    private _showPlacementIdleHint(): void {
        if (!this._dragStepDone || !this.uiHand) return;

        const target = this._pickRandomPlacementTarget();
        if (!target) return;

        this._playInstallPathHint(target.item, target.clone, () => {
            this._schedulePlacementIdleHint(this.placementIdleRepeatDelay);
        });
    }

    private _playInstallPathHint(item: DraggableItem, clone: Node, onComplete: () => void): void {
        if (!this.uiHand?.isValid || !clone.isValid || item.isPlaced) return;
        this._playDragPathHint(clone, item, onComplete);
    }

    private _playDragPathHint(clone: Node, item: DraggableItem, onComplete?: () => void): void {
        if (!this.uiHand?.isValid || !clone.isValid || item.isPlaced) return;

        if (!item.isPlaced) {
            item.playHologramHint();
        }

        const startPos = this._getVisualCenterWorld(clone);
        const targetPos = this._getVisualCenterWorld(item.node);

        this._prepareHandAt(startPos);
        this._showHintGhost(item, clone);

        tween(this.uiHand!)
            .delay(0.2)
            .to(this.dragHintMoveDuration, { worldPosition: targetPos }, {
                easing: 'quadInOut',
                onUpdate: () => this._hintDragGhost.syncFollow(),
            })
            .call(() => {
                this._hideHand();
                onComplete?.();
            })
            .start();
    }

    private _syncHintGhostSettings(): void {
        this._hintDragGhost.localOffset = this.hintGhostLocalOffset.clone();
        this._hintDragGhost.glowColor = new Color(
            this.hintGhostGlowColor.r,
            this.hintGhostGlowColor.g,
            this.hintGhostGlowColor.b,
            this.hintGhostGlowAlpha,
        );
        this._hintDragGhost.glowLayerCount = this.hintGhostBlurLayers;
        this._hintDragGhost.glowOuterScale = this.hintGhostGlowOuterScale;
        this._hintDragGhost.glowMaterial = this.hintGhostGlowMaterial;
    }

    private _ensureHintGhostMaterial(): void {
        if (this.hintGhostGlowMaterial) return;
        assetManager.loadAny({ uuid: HINT_GHOST_GLOW_MATERIAL_UUID }, (err, asset) => {
            if (err || !asset) {
                console.warn('[ManualController] SpriteSolidFill material not loaded', err);
                return;
            }
            this.hintGhostGlowMaterial = asset as Material;
            this._syncHintGhostSettings();
            this._refreshActiveHintGhost();
        });
    }

    private _showHintGhost(item: DraggableItem, clone: Node): void {
        if (!this.uiHand?.isValid || !clone.isValid) return;
        this._syncHintGhostSettings();
        this._hintGhostVisualItem = item;
        this._hintGhostHiddenClone = clone;
        this._hintDragGhost.showFromClone(this.uiHand, item, clone);
        clone.active = false;
    }

    private _refreshActiveHintGhost(): void {
        if (!this._hintGhostHiddenClone?.isValid || !this._hintGhostVisualItem || !this.uiHand?.isValid) return;
        if (!this._hintDragGhost.isShowing()) return;
        this._syncHintGhostSettings();
        this._hintDragGhost.showFromClone(this.uiHand, this._hintGhostVisualItem, this._hintGhostHiddenClone);
    }

    private _hideHintGhost(withFade: boolean): void {
        const onHidden = () => this._restoreHintClone();
        if (withFade) {
            this._hintDragGhost.fadeOut(this.handParticleFadeDelay, onHidden);
            return;
        }
        this._hintDragGhost.hideImmediate();
        onHidden();
    }

    private _restoreHintClone(): void {
        const clone = this._hintGhostHiddenClone;
        this._hintGhostHiddenClone = null;
        this._hintGhostVisualItem = null;
        if (!clone?.isValid) return;
        clone.active = true;
    }

    private _playHandTap(onComplete?: () => void): void {
        const anim = this._getHandAnimation();
        if (!anim) {
            onComplete?.();
            return;
        }

        this._clearHandTapCompletion();
        this._handTapOnComplete = onComplete ?? null;
        anim.once(Animation.EventType.FINISHED, this._onHandTapAnimFinished, this);
        anim.play('HandTap');
    }

    private _onHandTapAnimFinished = (): void => {
        const onComplete = this._handTapOnComplete;
        this._handTapOnComplete = null;
        onComplete?.();
    };

    private _clearHandTapCompletion(): void {
        const anim = this._getHandAnimation();
        anim?.off(Animation.EventType.FINISHED, this._onHandTapAnimFinished, this);
        this._handTapOnComplete = null;
    };

    private _getHandAnimation(): Animation | null {
        if (!this.uiHand?.isValid) return null;
        return this.uiHand.getComponent(Animation);
    }

    /** Плавно гасит эмиттер после цикла HandTap у коробки */
    private _fadeHandParticlesAfterHint(): void {
        this._setHandVisualVisible(false);
        this._runHandParticleFadeOut();
    }

    private _hideHand(deactivateHand = false): void {
        if (!this.uiHand?.isValid) return;
        this._clearHandTapCompletion();
        this._stopHandTweens();
        this._resetHandAnimation();
        this._setHandVisualVisible(false);

        this._hideHintGhost(!deactivateHand);

        if (deactivateHand) {
            this._handParticleFadeToken++;
            this._cancelHandParticleFade(true);
            this._hintDragGhost.hideImmediate();
            this.uiHand.active = false;
            return;
        }

        this._runHandParticleFadeOut();
    }

    /** Отсоединяет эмиттер на Canvas и плавно гасит через alpha частиц */
    private _runHandParticleFadeOut(onComplete?: () => void): void {
        this._fadeOutHandParticles(this.handParticleFadeDelay, onComplete);
        if (this.uiHand?.isValid) {
            this.uiHand.active = false;
        }
    }

    private _stopHandTweens(): void {
        if (this.uiHand?.isValid) {
            Tween.stopAllByTarget(this.uiHand);
        }
    }

    private _prepareHandAt(worldPos: Vec3): void {
        if (!this.uiHand?.isValid) return;
        this._handParticleFadeToken++;
        this._cancelHandParticleFade(true);
        this._stopHandTweens();
        this._resetHandTransformForPathHint();
        this.uiHand.active = true;
        this.uiHand.setWorldPosition(worldPos);
        this._showHandVisual();
        this._startHandParticles();
    }

    private _resetHandAnimation(): void {
        const anim = this._getHandAnimation();
        if (!anim) return;

        this._clearHandTapCompletion();
        anim.stop();
        // HandTap анимирует alpha спрайта: после stop() рука может остаться невидимой.
        this._restoreHandSpriteColor();
    }

    private _resetHandTransformForPathHint(): void {
        if (!this.uiHand?.isValid) return;
        this._resetHandAnimation();
        this.uiHand.setPosition(this._uiHandDefaultLocalPos);
        this.uiHand.setRotationFromEuler(this._uiHandDefaultLocalEuler);
        this.uiHand.setScale(this._uiHandDefaultLocalScale);
    }

    private _cacheHandParts(): void {
        if (!this.uiHand) return;
        this._uiHandDefaultLocalPos.set(this.uiHand.position);
        this._uiHandDefaultLocalEuler.set(this.uiHand.eulerAngles);
        this._uiHandDefaultLocalScale.set(this.uiHand.scale);
        this._handSprite = this.uiHand.getComponent(Sprite);
        if (this._handSprite) {
            this._handSpriteDefaultColor = this._handSprite.color.clone();
        }
        const particleDrug = this.uiHand.getChildByName('ParticleDrug');
        this._handParticleNode = particleDrug ?? null;
        this._refreshHandParticles(true);
    }

    private _refreshHandParticles(forceRescan = false): void {
        if (!forceRescan) {
            const cached = this._handParticles.filter(
                (particles) => particles?.isValid && particles.node?.isValid,
            );
            if (cached.length > 0) {
                this._handParticles = cached;
                this._cacheHandParticleDefaults(cached);
                return;
            }
        }

        const resolved: ParticleSystem2D[] = [];

        if (this._handParticleNode?.isValid) {
            const ps = this._handParticleNode.getComponent(ParticleSystem2D);
            if (ps?.isValid) resolved.push(ps);
        }

        if (resolved.length === 0 && this.uiHand?.isValid) {
            const particleDrug = this.uiHand.getChildByName('ParticleDrug');
            if (particleDrug) this._handParticleNode = particleDrug;

            const fromDrug = particleDrug?.getComponent(ParticleSystem2D);
            if (fromDrug) {
                resolved.push(fromDrug);
            } else {
                resolved.push(...this.uiHand.getComponentsInChildren(ParticleSystem2D));
            }
        }

        if (resolved.length === 0 && this.node?.isValid) {
            for (const child of this.node.children) {
                if (child.name !== 'ParticleDrug' || !child.isValid) continue;
                const ps = child.getComponent(ParticleSystem2D);
                if (ps?.isValid) {
                    this._handParticleNode = child;
                    resolved.push(ps);
                    break;
                }
            }
        }

        this._handParticles = resolved.filter((particles) => particles?.isValid && particles.node?.isValid);
        this._cacheHandParticleDefaults(this._handParticles);
    }

    private _cacheHandParticleDefaults(particles: ParticleSystem2D[]): void {
        for (const ps of particles) {
            if (!ps?.isValid) continue;
            if (!this._handParticleEmissionRates.has(ps)) {
                this._handParticleEmissionRates.set(ps, ps.emissionRate);
            }
            if (!this._handParticleDefaultColors.has(ps)) {
                this._handParticleDefaultColors.set(ps, ps.color.clone());
            }
        }
    }

    private _cleanupHandParticlesOnDestroy(): void {
        for (const particles of this._handParticles) {
            if (!particles?.isValid || !particles.node?.isValid) continue;

            Tween.stopAllByTarget(particles);
            const defaultColor = this._handParticleDefaultColors.get(particles);
            if (defaultColor) particles.color = defaultColor.clone();
        }
        this._handParticles = [];
    }

    private _setHandVisualVisible(visible: boolean): void {
        if (!this._handSprite?.isValid) return;
        this._handSprite.enabled = visible;
        if (visible) {
            this._restoreHandSpriteColor();
        }
    }

    private _showHandVisual(): void {
        this._setHandVisualVisible(true);
    }

    private _restoreHandSpriteColor(): void {
        if (!this._handSprite?.isValid) return;
        this._handSprite.color = this._handSpriteDefaultColor
            ? this._handSpriteDefaultColor.clone()
            : new Color(255, 255, 255, 255);
    }

    private _cancelHandParticleFade(resetOpacity: boolean): void {
        this._refreshHandParticles();

        for (const particles of this._handParticles) {
            const particleNode = particles?.node;
            if (!particleNode?.isValid) continue;

            Tween.stopAllByTarget(particles);

            if (resetOpacity) {
                const defaultColor = this._handParticleDefaultColors.get(particles);
                if (defaultColor) particles.color = defaultColor.clone();
            }

            if (this.uiHand?.isValid && particleNode.parent !== this.uiHand) {
                particleNode.setParent(this.uiHand, true);
            }
        }
    }

    private _fadeOutHandParticles(duration: number, onComplete?: () => void): void {
        const token = ++this._handParticleFadeToken;
        if (!this.node?.isValid) {
            onComplete?.();
            return;
        }

        if (this.uiHand?.isValid || this.node?.isValid) {
            this._refreshHandParticles();
        }

        const activeParticles = this._handParticles.filter(
            (particles) => particles?.isValid && particles.node?.isValid,
        );
        if (activeParticles.length === 0) {
            onComplete?.();
            return;
        }

        const fadeHost = this.node;
        let pending = activeParticles.length;
        const finishOne = (): void => {
            pending -= 1;
            if (pending === 0 && token === this._handParticleFadeToken) {
                onComplete?.();
            }
        };

        for (const particles of activeParticles) {
            const particleNode = particles.node;
            particles.emissionRate = 0;
            particleNode.setParent(fadeHost, true);
            particleNode.active = true;

            const defaultColor = this._handParticleDefaultColors.get(particles) ?? particles.color.clone();
            const fadeState = { a: defaultColor.a };

            Tween.stopAllByTarget(particles);
            tween(fadeState)
                .to(duration, { a: 0 }, {
                    easing: 'quadOut',
                    onUpdate: () => {
                        if (!particles.isValid) return;
                        const c = defaultColor.clone();
                        c.a = Math.max(0, Math.round(fadeState.a));
                        particles.color = c;
                    },
                })
                .call(() => {
                    if (token !== this._handParticleFadeToken) return;
                    if (!particleNode.isValid) {
                        finishOne();
                        return;
                    }
                    if (particles.isValid) {
                        particles.color = defaultColor.clone();
                    }
                    if (this.uiHand?.isValid) {
                        particleNode.setParent(this.uiHand, true);
                    }
                    finishOne();
                })
                .start();
        }
    }

    /** Запускает эмиссию заново при появлении руки */
    private _startHandParticles(): void {
        this._refreshHandParticles();
        for (const particles of this._handParticles) {
            if (!particles?.isValid || !particles.node?.isValid) continue;

            const particleNode = particles.node;
            Tween.stopAllByTarget(particles);

            const defaultColor = this._handParticleDefaultColors.get(particles);
            if (defaultColor) particles.color = defaultColor.clone();

            if (this.uiHand?.isValid && particleNode.parent !== this.uiHand) {
                particleNode.setParent(this.uiHand, true);
            }

            particleNode.active = true;
            particles.enabled = true;
            const emissionRate = this._handParticleEmissionRates.get(particles);
            if (emissionRate !== undefined) {
                particles.emissionRate = emissionRate;
            }
            particles.resetSystem();
        }
    }

    private _getVisualCenterWorld(node: Node): Vec3 {
        const spriteNode = node.getChildByName('Sprite') ?? node;
        const uiTransform = spriteNode.getComponent(UITransform) ?? node.getComponent(UITransform);
        if (!uiTransform) return spriteNode.worldPosition.clone();

        const rect = uiTransform.getBoundingBoxToWorld();
        return new Vec3(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5, spriteNode.worldPosition.z);
    }

    private _pickRandomPlacementTarget(): SpawnedHintTarget | null {
        const available = this._getAvailablePlacementTargets();
        if (available.length === 0) return null;
        return available[Math.floor(Math.random() * available.length)];
    }

    private _getAvailablePlacementTargets(): SpawnedHintTarget[] {
        this._cleanupSpawnedHintTargets();
        return this._spawnedHintTargets;
    }

    private _cleanupSpawnedHintTargets(): void {
        this._spawnedHintTargets = this._spawnedHintTargets.filter(({ item, clone }) => {
            return !!item && !!clone && clone.isValid && clone.active && !item.isPlaced;
        });
    }
}
