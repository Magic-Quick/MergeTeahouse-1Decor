import { _decorator, Animation, assetManager, Color, Component, Material, Node, ParticleSystem2D, Sprite, SpriteFrame, tween, Tween, UITransform, Vec3 } from 'cc';
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

/** assets/materials/SpriteContourGlow.mtl */
const HINT_GHOST_CONTOUR_MATERIAL_UUID = 'e8a4c3f2-5b6d-4f7a-8e2d-4f9b0c1d3e5a';
/** assets/materials/SpriteSolidFill.mtl — запасной fallback */
const HINT_GHOST_GLOW_MATERIAL_UUID = 'd5f9b2e3-0c4e-5f7b-9a2d-3e6f8b0c1d4e';
/** assets/materials/materialLight-001.mtl */
const HINT_GHOST_ADDITIVE_MATERIAL_UUID = 'e3b5d001-d67b-4af5-a645-8e7429d06539';
/** assets/sprites/fx/LightCircle.png */
const HINT_GHOST_SOFT_FRAME_UUID = 'ba870ec6-c1bd-4e05-97fa-534676ac6225@f9941';
/** Лимит emissionRate для подсказок — в префабе 300, полный rate вешает превью */
const HINT_PARTICLE_MAX_EMISSION = 120;
/** Значение из ParticleHit / ParticleBox, если в кэш попал 0 после stopSystem */
const HINT_PARTICLE_DEFAULT_EMISSION = 300;

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

    @property({
        type: Node,
        tooltip: 'Частицы при подсказке на коробку (Canvas/.../Box/ParticleBox). Пусто — ищется под boxNode.',
    })
    boxHintParticleNode: Node | null = null;

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

    @property({ tooltip: 'Длительность плавного гашения эмиттера подсказки (коробка или рука), сек' })
    handParticleFadeDelay: number = 0.8;

    @property({ tooltip: 'Частицы на подсказках. Выключите, если при появлении руки зависает превью.' })
    enableHintParticles: boolean = true;

    @property({ tooltip: 'Локальное смещение копии предмета под пальцем (от UiHand)' })
    hintGhostLocalOffset: Vec3 = new Vec3(35, -130, 0);

    @property({ tooltip: 'Круглая текстура (BlurCircle). Выключено = свечение по форме предмета (SpriteContourGlow).' })
    hintGhostSoftGlow: boolean = false;

    @property({
        type: SpriteFrame,
        tooltip: 'Текстура мягкого свечения под предметом. Пусто — подставится LightCircle из assets/sprites/fx.',
    })
    hintGhostSoftGlowSpriteFrame: SpriteFrame | null = null;

    @property({ type: Material, tooltip: 'Аддитивный материал свечения (materialLight-001). Пусто — подгрузка.' })
    hintGhostGlowAdditiveMaterial: Material | null = null;

    @property({ type: Material, tooltip: 'Свечение по контуру: SpriteContourGlow. Пусто — подгрузка.' })
    hintGhostContourGlowMaterial: Material | null = null;

    @property({ type: Material, tooltip: 'Запасной fallback: SpriteSolidFill (чёткие слои, без размытия)' })
    hintGhostGlowMaterial: Material | null = null;

    @property({ tooltip: 'Мягкость размытия контура (0–1), для SpriteContourGlow' })
    hintGhostGlowSoftness: number = 0.65;

    @property({ tooltip: 'Яркость ореола (0–2), для SpriteContourGlow' })
    hintGhostGlowIntensity: number = 1.2;

    @property({ tooltip: 'Цвет заливки свечения (RGB)' })
    hintGhostGlowColor: Color = new Color(255, 214, 72, 255);

    @property({ tooltip: 'Прозрачность свечения (0–255)' })
    hintGhostGlowAlpha: number = 150;

    @property({ tooltip: 'Ширина ореола: для контура — радиус размытия; для круга — масштаб текстуры (1.2–1.6).' })
    hintGhostGlowOuterScale: number = 1.38;

    @property({ tooltip: 'Только для круглой текстуры / fallback-слоёв (2–5)' })
    hintGhostBlurLayers: number = 4;

    private _unsubs: Array<() => void> = [];
    private _gameCompleted: boolean = false;
    private _dragStepDone: boolean = false;
    private _firstItem: DraggableItem | null = null;
    private _firstClone: Node | null = null;
    private _spawnedHintTargets: SpawnedHintTarget[] = [];
    private _handParticles: ParticleSystem2D[] = [];
    private _handParticleNode: Node | null = null;
    private _boxParticles: ParticleSystem2D[] = [];
    private _boxParticleNode: Node | null = null;
    private _particleEmissionRates = new Map<ParticleSystem2D, number>();
    private _particleDefaultColors = new Map<ParticleSystem2D, Color>();
    private _activeParticleSource: 'hand' | 'box' | null = null;
    private _handSprite: Sprite | null = null;
    private _handSpriteDefaultColor: Color | null = null;
    private _handTapOnComplete: (() => void) | null = null;
    private _particleFadeToken = 0;
    private _scheduledParticleFade: (() => void) | null = null;
    /** Частицы инициализируются лениво — не в onLoad, чтобы не блокировать старт превью */
    private _particlesReady = false;
    private readonly _hintDragGhost = new HintDragGhost();
    /** Клон из коробки, скрытый на время drag-подсказки (под пальцем показывается HintItemGhost) */
    private _hintGhostHiddenClone: Node | null = null;
    private _hintGhostVisualItem: DraggableItem | null = null;
    private readonly _uiHandDefaultLocalPos = new Vec3();
    private readonly _uiHandDefaultLocalEuler = new Vec3();
    private readonly _uiHandDefaultLocalScale = new Vec3(1, 1, 1);

    onLoad(): void {
        this._syncHintGhostSettings();
        this._cacheHandVisualParts();
        this._resolveBoxParticleNode();
        this._hideHandImmediate();
        this._unsubs.push(
            GlobalEventBus.subscribe(EVT_CHEST_TAPPED, () => this._onChestTapped()),
            GlobalEventBus.subscribe<ItemSpawnedEvent>(EVT_ITEM_SPAWNED, (event) => this._onItemSpawned(event)),
            GlobalEventBus.subscribe(EVT_ITEM_DRAG_START, () => this._onItemDragStart()),
            GlobalEventBus.subscribe<ItemPlacedEvent>(EVT_ITEM_PLACED, (event) => this._onItemPlaced(event)),
            GlobalEventBus.subscribe(EVT_GAME_COMPLETE, () => this._onGameComplete()),
        );
    }

    start(): void {
        this._ensureHintGhostAssets();
        this._scheduleBoxHint(this.boxHintDelay);
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._scheduledParticleFade = null;
        this._particleFadeToken++;
        this._handTapOnComplete = null;
        const anim = this._getHandAnimation();
        anim?.off(Animation.EventType.FINISHED, this._onHandTapAnimFinished, this);
        if (this.uiHand?.isValid) {
            Tween.stopAllByTarget(this.uiHand);
        }
        this._cleanupParticlesOnDestroy();
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

        this._prepareHandAt(this.boxNode.worldPosition, 'box');
        this._playHandTap(this._onBoxHandTapCycleEnd);
    }

    private _onBoxHandTapCycleEnd = (): void => {
        this._fadeParticlesAfterBoxHint();
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

        this._prepareHandAt(startPos, 'hand');
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
        this._hintDragGhost.useSoftGlow = this.hintGhostSoftGlow;
        this._hintDragGhost.glowSoftSpriteFrame = this.hintGhostSoftGlowSpriteFrame;
        this._hintDragGhost.glowLayerCount = this.hintGhostBlurLayers;
        this._hintDragGhost.glowOuterScale = this.hintGhostGlowOuterScale;
        this._hintDragGhost.glowAdditiveMaterial = this.hintGhostGlowAdditiveMaterial;
        this._hintDragGhost.glowContourMaterial = this.hintGhostContourGlowMaterial;
        this._hintDragGhost.glowRadius = this._resolveHintGlowRadius();
        this._hintDragGhost.glowSoftness = this.hintGhostGlowSoftness;
        this._hintDragGhost.glowIntensity = this.hintGhostGlowIntensity;
        this._hintDragGhost.glowMaterial = this.hintGhostGlowMaterial;
    }

    /** Outer Scale 1.0–1.6 → UV-радиус размытия контура */
    private _resolveHintGlowRadius(): number {
        const scale = Math.max(1, this.hintGhostGlowOuterScale);
        return 0.035 + (scale - 1) * 0.09;
    }

    private _ensureHintGhostAssets(): void {
        this._syncHintGhostSettings();

        if (this.hintGhostSoftGlow) {
            if (!this.hintGhostGlowAdditiveMaterial) {
                assetManager.loadAny({ uuid: HINT_GHOST_ADDITIVE_MATERIAL_UUID }, (err, asset) => {
                    if (!err && asset) {
                        this.hintGhostGlowAdditiveMaterial = asset as Material;
                        this._syncHintGhostSettings();
                        this._refreshActiveHintGhost();
                    }
                });
            }
            if (!this.hintGhostSoftGlowSpriteFrame && !this._hintDragGhost.glowSoftSpriteFrame) {
                assetManager.loadAny({ uuid: HINT_GHOST_SOFT_FRAME_UUID }, (err, asset) => {
                    if (!err && asset) {
                        this._hintDragGhost.glowSoftSpriteFrame = asset as SpriteFrame;
                        this._refreshActiveHintGhost();
                    }
                });
            }
            return;
        }

        if (!this.hintGhostContourGlowMaterial) {
            assetManager.loadAny({ uuid: HINT_GHOST_CONTOUR_MATERIAL_UUID }, (err, asset) => {
                if (!err && asset) {
                    this.hintGhostContourGlowMaterial = asset as Material;
                    this._syncHintGhostSettings();
                    this._refreshActiveHintGhost();
                }
            });
        }

        if (!this.hintGhostGlowMaterial) {
            assetManager.loadAny({ uuid: HINT_GHOST_GLOW_MATERIAL_UUID }, (err, asset) => {
                if (!err && asset) {
                    this.hintGhostGlowMaterial = asset as Material;
                    this._syncHintGhostSettings();
                    this._refreshActiveHintGhost();
                }
            });
        }
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
        const state = anim.getState('HandTap');
        if (state) {
            state.wrapMode = 1;
            state.repeatCount = 1;
        }
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

    /** Плавно гасит ParticleBox после цикла HandTap у коробки */
    private _fadeParticlesAfterBoxHint(): void {
        this._setHandVisualVisible(false);
        if (this._particlesReady) {
            this._runParticleFadeOut('box');
        } else if (this.uiHand?.isValid) {
            this.uiHand.active = false;
        }
    }

    private _hideHand(deactivateHand = false): void {
        this._clearHandTapCompletion();
        this._stopHandTweens();

        if (this.uiHand?.isValid) {
            this._resetHandAnimation();
            this._setHandVisualVisible(false);
        }

        this._hideHintGhost(!deactivateHand);

        if (deactivateHand) {
            this._particleFadeToken++;
            if (this._particlesReady) {
                this._cancelParticleFade('hand', true);
                this._cancelParticleFade('box', true);
            }
            this._activeParticleSource = null;
            this._hintDragGhost.hideImmediate();
            if (this.uiHand?.isValid) {
                this.uiHand.active = false;
            }
            return;
        }

        if (!this.uiHand?.isValid) return;

        if (this._activeParticleSource && this._particlesReady) {
            this._runParticleFadeOut(this._activeParticleSource);
        } else {
            this.uiHand.active = false;
        }
    }

    /** Скрыть руку без трогания ParticleSystem (безопасно в onLoad) */
    private _hideHandImmediate(): void {
        this._hideHand(true);
    }

    /** Плавно гасит эмиттер подсказки и скрывает руку */
    private _runParticleFadeOut(source: 'hand' | 'box', onComplete?: () => void): void {
        this._fadeOutParticles(source, this.handParticleFadeDelay, () => {
            this._activeParticleSource = null;
            onComplete?.();
        });
        if (this.uiHand?.isValid) {
            this.uiHand.active = false;
        }
    }

    private _stopHandTweens(): void {
        if (this.uiHand?.isValid) {
            Tween.stopAllByTarget(this.uiHand);
        }
    }

    private _prepareHandAt(worldPos: Vec3, particleSource: 'hand' | 'box'): void {
        if (!this.uiHand?.isValid) return;
        this._ensureParticlesReady();
        this._particleFadeToken++;
        this._cancelParticleFade('hand', true);
        this._cancelParticleFade('box', true);
        this._activeParticleSource = particleSource;
        this._stopHandTweens();
        this._resetHandTransformForPathHint();
        this.uiHand.active = true;
        this.uiHand.setWorldPosition(worldPos);
        this._showHandVisual();
        this._startParticles(particleSource);
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

    private _cacheHandVisualParts(): void {
        if (!this.uiHand) return;
        this._uiHandDefaultLocalPos.set(this.uiHand.position);
        this._uiHandDefaultLocalEuler.set(this.uiHand.eulerAngles);
        this._uiHandDefaultLocalScale.set(this.uiHand.scale);
        this._handSprite = this.uiHand.getComponent(Sprite);
        if (this._handSprite) {
            this._handSpriteDefaultColor = this._handSprite.color.clone();
        }
    }

    private _ensureParticlesReady(): void {
        if (!this.enableHintParticles || this._particlesReady) return;
        this._particlesReady = true;
        this._initHandParticles();
        this._initBoxParticles();
    }

    private _initHandParticles(): void {
        if (!this.uiHand?.isValid) return;
        const particleDrug = this.uiHand.getChildByName('ParticleDrug');
        this._handParticleNode = particleDrug ?? null;
        this._refreshHandParticles(true);
        this._stopParticlesIdle('hand');
    }

    private _initBoxParticles(): void {
        this._resolveBoxParticleNode();
        this._refreshBoxParticles(true);
        this._stopParticlesIdle('box');
    }

    private _resolveBoxParticleNode(): void {
        if (this.boxHintParticleNode?.isValid) {
            this._boxParticleNode = this.boxHintParticleNode;
            return;
        }
        if (!this.boxNode?.isValid) {
            this._boxParticleNode = null;
            return;
        }
        if (this.boxNode === this.node || this.boxNode === this.uiHand) {
            console.warn('[ManualController] boxNode указывает на Canvas/UiHand — ParticleBox не ищем');
            this._boxParticleNode = null;
            return;
        }
        this._boxParticleNode = this._findChildByName(this.boxNode, 'ParticleBox', 32);
    }

    private _refreshHandParticles(forceRescan = false): void {
        if (!forceRescan) {
            const cached = this._handParticles.filter(
                (particles) => particles?.isValid && particles.node?.isValid,
            );
            if (cached.length > 0) {
                this._handParticles = cached;
                this._cacheParticleDefaults(cached);
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
            if (fromDrug?.isValid) {
                resolved.push(fromDrug);
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
        this._cacheParticleDefaults(this._handParticles);
    }

    private _stopParticlesIdle(source: 'hand' | 'box'): void {
        this._refreshParticles(source);
        for (const particles of this._getParticles(source)) {
            if (!particles?.isValid) continue;
            particles.emissionRate = 0;
            particles.stopSystem();
        }
    }

    private _findChildByName(root: Node, name: string, budget = 64): Node | null {
        if (!root.isValid || budget <= 0) return null;
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this._findChildByName(child, name, budget - 1);
            if (found) return found;
        }
        return null;
    }

    private _refreshBoxParticles(forceRescan = false): void {
        if (!forceRescan) {
            const cached = this._boxParticles.filter(
                (particles) => particles?.isValid && particles.node?.isValid,
            );
            if (cached.length > 0) {
                this._boxParticles = cached;
                this._cacheParticleDefaults(cached);
                return;
            }
        }

        const resolved = this._boxParticleNode?.isValid
            ? this._collectParticleSystems(this._boxParticleNode)
            : [];

        this._boxParticles = resolved.filter((particles) => particles?.isValid && particles.node?.isValid);
        this._cacheParticleDefaults(this._boxParticles);
    }

    private _collectParticleSystems(root: Node): ParticleSystem2D[] {
        if (!root.isValid) return [];
        const direct = root.getComponent(ParticleSystem2D);
        if (direct?.isValid) return [direct];
        const fromChildren = root.getComponentsInChildren(ParticleSystem2D);
        return fromChildren.filter((ps) => ps?.isValid && ps.node?.isValid);
    }

    private _cacheParticleDefaults(particles: ParticleSystem2D[]): void {
        for (const ps of particles) {
            if (!ps?.isValid) continue;
            if (!this._particleEmissionRates.has(ps)) {
                const rate = ps.emissionRate > 0 ? ps.emissionRate : HINT_PARTICLE_DEFAULT_EMISSION;
                this._particleEmissionRates.set(ps, rate);
            }
            if (!this._particleDefaultColors.has(ps)) {
                this._particleDefaultColors.set(ps, ps.color.clone());
            }
        }
    }

    private _getParticleHomeNode(source: 'hand' | 'box'): Node | null {
        return source === 'hand' ? this.uiHand : this._boxParticleNode;
    }

    private _refreshParticles(source: 'hand' | 'box', forceRescan = false): void {
        if (source === 'hand') {
            this._refreshHandParticles(forceRescan);
            return;
        }
        this._refreshBoxParticles(forceRescan);
    }

    private _getParticles(source: 'hand' | 'box'): ParticleSystem2D[] {
        return source === 'hand' ? this._handParticles : this._boxParticles;
    }

    private _cleanupParticlesOnDestroy(): void {
        if (!this._particlesReady) return;
        for (const particles of [...this._handParticles, ...this._boxParticles]) {
            if (!particles?.isValid || !particles.node?.isValid) continue;

            particles.emissionRate = 0;
            particles.stopSystem();
            const defaultColor = this._particleDefaultColors.get(particles);
            if (defaultColor) particles.color = defaultColor.clone();
        }
        this._handParticles = [];
        this._boxParticles = [];
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

    private _cancelParticleFade(source: 'hand' | 'box', resetOpacity: boolean): void {
        if (!this._particlesReady) return;
        if (this._scheduledParticleFade) {
            this.unschedule(this._scheduledParticleFade);
            this._scheduledParticleFade = null;
        }
        this._refreshParticles(source);

        for (const particles of this._getParticles(source)) {
            if (!particles?.isValid) continue;
            particles.emissionRate = 0;
            particles.stopSystem();
            if (resetOpacity) {
                const defaultColor = this._particleDefaultColors.get(particles);
                if (defaultColor) particles.color = defaultColor.clone();
            }
        }
    }

    private _fadeOutParticles(source: 'hand' | 'box', duration: number, onComplete?: () => void): void {
        if (!this.enableHintParticles || !this._particlesReady) {
            onComplete?.();
            return;
        }

        if (this._scheduledParticleFade) {
            this.unschedule(this._scheduledParticleFade);
            this._scheduledParticleFade = null;
        }

        const token = ++this._particleFadeToken;
        this._refreshParticles(source);

        const activeParticles = this._getParticles(source).filter(
            (particles) => particles?.isValid && particles.node?.isValid,
        );
        if (activeParticles.length === 0) {
            onComplete?.();
            return;
        }

        for (const particles of activeParticles) {
            particles.emissionRate = 0;
            particles.stopSystem();
        }

        this._scheduledParticleFade = () => {
            this._scheduledParticleFade = null;
            if (token !== this._particleFadeToken) return;

            for (const particles of activeParticles) {
                if (!particles?.isValid) continue;
                const defaultColor = this._particleDefaultColors.get(particles);
                if (defaultColor) particles.color = defaultColor.clone();
            }
            onComplete?.();
        };
        this.scheduleOnce(this._scheduledParticleFade, duration);
    }

    private _resolveHintEmissionRate(particles: ParticleSystem2D): number {
        const saved = this._particleEmissionRates.get(particles) ?? HINT_PARTICLE_DEFAULT_EMISSION;
        const base = saved > 0 ? saved : HINT_PARTICLE_DEFAULT_EMISSION;
        return Math.min(base, HINT_PARTICLE_MAX_EMISSION);
    }

    /** Запускает эмиссию подсказки (ParticleBox — с resetSystem, иначе не видно после stop) */
    private _startParticles(source: 'hand' | 'box'): void {
        if (!this.enableHintParticles || !this._particlesReady) return;
        this._refreshParticles(source);

        for (const particles of this._getParticles(source)) {
            if (!particles?.isValid || !particles.node?.isValid) continue;

            const defaultColor = this._particleDefaultColors.get(particles);
            if (defaultColor) particles.color = defaultColor.clone();

            const particleNode = particles.node;
            particleNode.active = true;
            particles.enabled = true;

            const rate = this._resolveHintEmissionRate(particles);
            particles.emissionRate = rate;

            if (source === 'box') {
                if (this._boxParticleNode?.isValid) {
                    this._boxParticleNode.active = true;
                }
                particles.resetSystem();
            } else {
                particles.stopSystem();
                if (rate > 0) {
                    particles.resetSystem();
                }
            }
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
