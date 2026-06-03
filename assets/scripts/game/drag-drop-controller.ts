import {
    _decorator, Component, Node, Camera, Vec2, Vec3,
    EventTouch, UITransform, input, Input, tween, instantiate, Animation,
    ParticleSystem2D, Enum,
} from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import {
    EVT_CHEST_TAPPED,
    EVT_ITEM_SPAWNED,
    EVT_ITEM_DRAG_START,
    EVT_ITEM_DRAG_MOVE,
    EVT_ITEM_DRAG_END,
    EVT_ITEM_PLACED,
    EVT_ITEM_WRONG_SLOT,
    EVT_GAME_COMPLETE,
    EVT_PLAY_SOUND,
    SOUND_BOX_OPEN,
    SOUND_BOX_GET,
    SOUND_ITEM_SPAWN,
    SOUND_ITEM_PLACED,
    SOUND_WRONG_SLOT,
    SOUND_ROOM_COMPLETE,
} from 'db://assets/scripts/common/events';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';
import { DraggableItemSlot } from 'db://assets/scripts/game/draggable-item-slot';
import { CameraShake } from 'db://assets/scripts/CameraShake';
import { AppLovinAnalytics } from 'db://assets/scripts/core/AppLovinAnalytics';

const { ccclass, property } = _decorator;

enum MotionEasing {
    linear = 0,
    smooth = 1,
    quadOut = 2,
    quadInOut = 3,
    sineOut = 4,
    backOut = 5,
}

Enum(MotionEasing);

/**
 * DragDropController — компонент на корневой ноде сцены (Canvas).
 *
 * Механика:
 *   • itemSlots — массив DraggableItem-нод (оригиналы, невидимы, стоят на своих местах)
 *   • boxNode   — нода шкатулки; тап по ней порождает drag-копию следующего предмета
 *   • dragLayer — нода поверх всего; drag-копии живут здесь
 *
 * Флоу:
 *   1. Тап по boxNode → берём itemSlots[currentIndex], клонируем ноду
 *   2. Клон вылетает из бокса и останавливается в случайной точке (готов к drag)
 *   3. Можно тапать по боксу снова — несколько клонов могут существовать одновременно
 *   4. Тап по клону → начинается drag
 *   5. При отпускании: если в радиусе оригинала → клон уничтожается, оригинал.reveal()
 *                      если промах → клон остаётся на месте
 *
 * Анимация покачивания:
 *   ItamFloatleft анимирует Y-позицию дочерней ноды Sprite.
 *   Поворот (tilt) управляется кодом через tween на eulerAngles.z ноды Sprite.
 *   При drag: pause() — анимация замирает в текущем кадре.
 *   При отпускании: resume() — продолжает с того же места.
 *   При промахе: tween поворота на противоположный угол.
 */
@ccclass('DragDropController')
export class DragDropController extends Component {

    @property({ type: [DraggableItemSlot], tooltip: 'Слоты предметов: ссылка + spawn scale при вылете из коробки' })
    itemSlots: DraggableItemSlot[] = [];

    @property({ type: Node, tooltip: 'Нода шкатулки (BoxClosed/BoxOpened)' })
    boxNode: Node | null = null;

    @property({ type: Node, tooltip: 'Drag-layer: последняя нода в Canvas, рисуется поверх всего' })
    dragLayer: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Fall-layer: нода с UITransform, задающая зону случайного выпадения предметов (Canvas/RoomContainer/Drag-layer/Fall-layer)',
    })
    fallLayer: Node | null = null;

    @property({
        tooltip: 'Угол наклона предмета при покачивании (градусы). Рандомно ±floatTiltAngle при спавне, меняется при промахе.',
    })
    floatTiltAngle: number = 15;

    @property({
        tooltip: 'Длительность tween поворота при смене наклона (сек)',
    })
    tiltDuration: number = 0.3;

    @property({ tooltip: 'Длительность мягкого выплывания предмета из коробки, сек' })
    spawnMoveDuration: number = 0.65;

    @property({ type: MotionEasing, tooltip: 'Easing выплывания из коробки' })
    spawnMoveEasing: MotionEasing = MotionEasing.quadOut;

    @property({ tooltip: 'Высота дуги при вылете предмета из коробки, world units' })
    spawnArcHeight: number = 180;

    @property({ tooltip: 'Проигрывать ParticleInstall при вылете предмета из коробки' })
    spawnInstallParticles: boolean = true;

    @property({ tooltip: 'Трясти камеру при доставании предмета из коробки' })
    shakeCameraOnSpawn: boolean = true;

    @property({ tooltip: 'Трясти камеру при установке предмета на место' })
    shakeCameraOnPlace: boolean = true;

    @property({ tooltip: 'Длительность мягкого снапа предмета к месту при установке, сек' })
    placementMoveDuration: number = 0.28;

    @property({ type: MotionEasing, tooltip: 'Easing снапа к месту' })
    placementMoveEasing: MotionEasing = MotionEasing.quadOut;

    @property({ tooltip: 'Множитель bounce-скейла после установки' })
    placementScalePunch: number = 1.12;

    @property({ tooltip: 'Длительность увеличения bounce после установки, сек' })
    placementScaleUpDuration: number = 0.12;

    @property({ tooltip: 'Длительность возврата bounce после установки, сек' })
    placementScaleDownDuration: number = 0.22;

    /** Runtime-настройка из GameConfig */
    ctaDelay: number = 3;

    /** Runtime-настройка из GameConfig: 0 = подсказка появляется сразу */
    missesBeforeHint: number = 2;

    /** Runtime-настройка из GameConfig */
    debugCompleteAfterFirstPlacement: boolean = false;

    /** Камера передаётся из Bootstrap через init() */
    private camera: Camera | null = null;

    /** CTA-нода передаётся из Bootstrap через init() */
    private ctaNode: Node | null = null;

    // ─── Состояние ───────────────────────────────────────────────────────────

    /** Индекс следующего предмета для выдачи из бокса */
    private currentIndex: number = 0;

    /**
     * Все активные клоны на сцене.
     * Ключ — нода клона, значение — оригинал DraggableItem.
     */
    private activeClones: Map<Node, DraggableItem> = new Map();

    /** true — сейчас эмитит ParticleDrug на конкретном клоне */
    private dragParticlesEmitting: Map<Node, boolean> = new Map();

    /** Таймер авто-остановки ParticleDrug при простое (даже если палец удерживается) */
    private _dragParticlesStopToken: number = 0;

    /**
     * Счётчик промахов для каждого клона.
     * После missesBeforeHint промахов запускается HologrammPulse на оригинале.
     */
    private missCount: Map<Node, number> = new Map();

    /**
     * Текущий угол наклона (tilt) каждого клона в градусах.
     * +floatTiltAngle или -floatTiltAngle. При промахе меняется знак.
     */
    private cloneTilt: Map<Node, number> = new Map();

    /** Флаг: анимация BoxOpen уже была проиграна */
    private _boxOpenPlayed: boolean = false;

    /** true после завершения игры — блокирует дальнейшие клики по коробке */
    private _gameCompleted: boolean = false;

    /** Активная drag-копия (та что сейчас тащится) */
    private dragClone: Node | null = null;
    /** Оригинал, которому принадлежит текущая копия */
    private dragOriginal: DraggableItem | null = null;
    /** Смещение от центра ноды до точки касания */
    private touchOffset: Vec3 = new Vec3();
    /** Идёт ли сейчас drag */
    private isDragging: boolean = false;

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    onLoad(): void {
        input.on(Input.EventType.TOUCH_START,  this._onTouchStart,  this);
        input.on(Input.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        input.on(Input.EventType.TOUCH_END,    this._onTouchEnd,    this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    start(): void {
        this._repairItemSlotsIfNeeded();
        this._gameCompleted = false;

        // Скрываем все оригиналы — они ждут своих drag-копий
        for (const slot of this.itemSlots) {
            if (this._isValidItemSlot(slot)) {
                slot.item.hide();
            }
        }
        // Скрываем CTA
        if (this.ctaNode) {
            this.ctaNode.active = false;
        }
        console.log(`[DragDropController] Скрыто оригиналов: ${this.itemSlots.length}`);
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START,  this._onTouchStart,  this);
        input.off(Input.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        input.off(Input.EventType.TOUCH_END,    this._onTouchEnd,    this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    // ─── Инициализация ───────────────────────────────────────────────────────

    init(camera: Camera, ctaNode: Node | null = null): void {
        this.camera = camera;
        this.ctaNode = ctaNode;
    }

    // ─── Touch handlers ──────────────────────────────────────────────────────

    private _onTouchStart(event: EventTouch): void {
        const worldPos = this._touchToWorld(event);

        // Если уже тащим — игнорируем
        if (this.isDragging) return;

        // Проверяем попадание по любому из активных клонов
        for (const [cloneNode, original] of this.activeClones) {
            if (!cloneNode.isValid || !cloneNode.active) continue;
            const uiTransform = cloneNode.getComponent(UITransform);
            if (!uiTransform) continue;
            const bb = uiTransform.getBoundingBoxToWorld();
            if (bb.contains(new Vec2(worldPos.x, worldPos.y))) {
                AppLovinAnalytics.gameStart();
                this.isDragging = true;
                this.dragClone = cloneNode;
                this.dragOriginal = original;

                // Запоминаем worldPosition клона ДО паузы анимации
                const cloneWorldPos = cloneNode.worldPosition.clone();

                // Паузируем ItamFloatleft — анимация замирает в текущем кадре,
                // localPosition Sprite НЕ сбрасывается (в отличие от stop()).
                const cloneAnim = cloneNode.getComponent(Animation);
                if (cloneAnim) {
                    cloneAnim.pause();
                }

                // Запускаем эмиттер частиц при drag (нода остаётся активной всегда)
                const particleNode = cloneNode.getChildByName('ParticleDrug');
                if (particleNode) {
                    particleNode.active = true;
                    const ps = particleNode.getComponent(ParticleSystem2D);
                    if (ps) ps.stopSystem(); // не создаём новые частицы без движения
                    this.dragParticlesEmitting.set(cloneNode, false);
                }

                // touchOffset от текущей worldPosition клона (с анимационным смещением)
                Vec3.subtract(this.touchOffset, cloneWorldPos, worldPos);

                GlobalEventBus.publish({ type: EVT_ITEM_DRAG_START, item: original });
                console.log(`[DragDropController] Drag start: "${original.itemId}"`);
                return;
            }
        }

        // Тап по боксу — спавним следующий предмет (без ограничений)
        if (!this._gameCompleted && this._hitTestNode(this.boxNode, worldPos)) {
            AppLovinAnalytics.gameStart();
            const spawned = this._spawnNextItem();
            if (!spawned) return;
            GlobalEventBus.publish({ type: EVT_CHEST_TAPPED });

            const boxAnim = this.boxNode?.getComponent(Animation);
            if (!boxAnim) return;

            // Первый спавн открывает коробку, следующие проигрывают короткую анимацию выдачи предмета.
            if (!this._boxOpenPlayed) {
                this._boxOpenPlayed = true;
                GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_BOX_OPEN });
                boxAnim.play('BoxOpen');
            } else {
                GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_BOX_GET });
                boxAnim.play('BoxGet');
            }
        }
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this.isDragging || !this.dragClone || !this.dragOriginal) return;
        const worldPos = this._touchToWorld(event);
        const targetWorldPos = new Vec3(
            worldPos.x + this.touchOffset.x,
            worldPos.y + this.touchOffset.y,
            this.dragClone.worldPosition.z,
        );
        const moved = Vec3.distance(this.dragClone.worldPosition, targetWorldPos) > 1;

        this.dragClone.setWorldPosition(
            targetWorldPos.x,
            targetWorldPos.y,
            targetWorldPos.z,
        );
        // Частицы при drag должны появляться только при заметном движении
        if (moved) {
            const particleNode = this.dragClone.getChildByName('ParticleDrug');
            if (particleNode) {
                const ps = particleNode.getComponent(ParticleSystem2D);
                if (ps && !this.dragParticlesEmitting.get(this.dragClone)) {
                    ps.resetSystem();
                    this.dragParticlesEmitting.set(this.dragClone, true);
                }
            }
            GlobalEventBus.publish({ type: EVT_ITEM_DRAG_MOVE, item: this.dragOriginal });
        }

        // TOUCH_MOVE не вызывается, когда палец не двигается, поэтому стопаем частицы по idle-таймеру.
        if (moved) {
            const token = ++this._dragParticlesStopToken;
            const cloneRef = this.dragClone;
            this.scheduleOnce(() => {
                if (token !== this._dragParticlesStopToken) return;
                if (!this.isDragging || this.dragClone !== cloneRef || !cloneRef?.isValid) return;
                const particleNode = cloneRef.getChildByName('ParticleDrug');
                if (!particleNode) return;
                const ps = particleNode.getComponent(ParticleSystem2D);
                if (ps && this.dragParticlesEmitting.get(cloneRef)) {
                    ps.stopSystem();
                    this.dragParticlesEmitting.set(cloneRef, false);
                }
            }, 0.12);
        }
    }

    private _onTouchEnd(_event: EventTouch): void {
        if (!this.isDragging || !this.dragClone || !this.dragOriginal) return;

        const original = this.dragOriginal;
        const clone = this.dragClone;

        this.isDragging = false;
        this.dragClone = null;
        this.dragOriginal = null;
        this._dragParticlesStopToken++;

        // Останавливаем эмиссию новых частиц — существующие доигрывают цикл
        const particleNode = clone.getChildByName('ParticleDrug');
        if (particleNode) {
            const ps = particleNode.getComponent(ParticleSystem2D);
            if (ps) ps.stopSystem(); // прекращает создание новых частиц, живые доигрывают
        }
        this.dragParticlesEmitting.delete(clone);

        // Ищем свободный слот с таким же itemId в радиусе дропа.
        // Это делает дубликаты взаимозаменяемыми: например, Carpet может встать
        // в любой свободный Carpet-слот, а не только в свой исходный original.
        const clonePos = clone.worldPosition;
        const placementTarget = this._findPlacementTarget(original, clonePos);
        const targetForLog = placementTarget ?? original;
        const dist = Vec3.distance(targetForLog.targetWorldPos, clonePos);
        const radius = placementTarget?.snapRadius ?? original.snapRadius;
        console.log(`[DragDropController] Drop: clone=(${clonePos.x.toFixed(0)},${clonePos.y.toFixed(0)}) target=(${targetForLog.targetWorldPos.x.toFixed(0)},${targetForLog.targetWorldPos.y.toFixed(0)}) dist=${dist.toFixed(0)} radius=${radius}`);

        if (placementTarget) {
            // Успех: клон летит к цели, исчезает, оригинал появляется
            this.activeClones.delete(clone);
            this.missCount.delete(clone);
            this.cloneTilt.delete(clone);
            this._alignCloneTiltToTarget(clone, placementTarget);
            const targetScale = placementTarget.node.scale.clone();
            tween(clone)
                .to(
                    this.placementMoveDuration,
                    {
                        worldPosition: placementTarget.targetWorldPos,
                        scale: targetScale,
                    },
                    { easing: this._resolveEasing(this.placementMoveEasing) },
                )
                .call(() => {
                    clone.destroy();
                    // Останавливаем HologrammPulse если он играл
                    original.stopHologramHint();
                    if (placementTarget !== original) {
                        placementTarget.stopHologramHint();
                    }
                    placementTarget.reveal(); // isPlaced = true здесь, node.active = true
                    if (this.shakeCameraOnPlace) {
                        this._shakeCamera();
                    }
                    if (placementTarget.node && placementTarget.node.isValid) {
                        const targetScale = placementTarget.node.scale.clone();
                        this._playPlaceEffect(placementTarget.node, targetScale);
                    }
                    GlobalEventBus.publish({ type: EVT_ITEM_PLACED, item: placementTarget });
                    // Проверяем завершение ПОСЛЕ reveal() — теперь isPlaced корректен
                    this._checkCompletion();
                })
                .start();

            GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_ITEM_PLACED });
            console.log(`[DragDropController] Placed: "${original.itemId}" -> "${placementTarget.node.name}"`);
        } else {
            // Промах: клон остаётся там где его бросили

            // Меняем угол наклона на противоположный и анимируем tween поворота
            const currentTilt = this.cloneTilt.get(clone) ?? this.floatTiltAngle;
            const nextTilt = -currentTilt;
            this.cloneTilt.set(clone, nextTilt);
            this._applyTilt(clone, nextTilt);

            // Возобновляем анимацию покачивания с того же кадра (resume, не play)
            const cloneAnim = clone.getComponent(Animation);
            if (cloneAnim) {
                cloneAnim.resume();
            }

            // Считаем промахи — запускаем HologrammPulse на оригинале как подсказку
            const misses = (this.missCount.get(clone) ?? 0) + 1;
            this.missCount.set(clone, misses);
            console.log(`[DragDropController] Miss #${misses}: "${original.itemId}" tilt=${nextTilt}°`);

            if (misses >= this.missesBeforeHint && !original.isPlaced) {
                original.playHologramHint();
            }

            GlobalEventBus.publish({ type: EVT_ITEM_WRONG_SLOT, item: original });
            GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_WRONG_SLOT });
        }

        GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: original });
    }

    private _onTouchCancel(_event: EventTouch): void {
        if (this.isDragging && this.dragOriginal) {
            if (this.dragClone) {
                // Возобновляем анимацию при отмене drag
                const cloneAnim = this.dragClone.getComponent(Animation);
                if (cloneAnim) cloneAnim.resume();
                // Останавливаем эмиссию новых частиц — существующие доигрывают
                const particleNode = this.dragClone.getChildByName('ParticleDrug');
                if (particleNode) {
                    const ps = particleNode.getComponent(ParticleSystem2D);
                    if (ps) ps.stopSystem();
                }
                this.dragParticlesEmitting.delete(this.dragClone);
            }
            GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: this.dragOriginal });
        }
        this.isDragging = false;
        this.dragClone = null;
        this.dragOriginal = null;
        this._dragParticlesStopToken++;
    }

    // ─── Спавн предмета ──────────────────────────────────────────────────────

    private _spawnNextItem(): boolean {
        // Ищем следующий незанятый предмет (цикл — нет риска stack overflow)
        let item: DraggableItem | null = null;
        while (this.currentIndex < this.itemSlots.length) {
            const slot = this.itemSlots[this.currentIndex];
            this.currentIndex++;
            if (!this._isValidItemSlot(slot)) {
                console.warn(`[DragDropController] itemSlots[${this.currentIndex - 1}] null или невалиден — пропускаем`);
                continue;
            }
            const candidate = slot.item;
            if (!candidate.isPlaced && !this._hasActiveCloneFor(candidate)) {
                item = candidate;
                break;
            }
        }

        if (!item) {
            console.log('[DragDropController] Все предметы уже выданы');
            return false;
        }

        const original: DraggableItem = item;

        // Проверяем что у оригинала есть валидная нода
        if (!original.node || !original.node.isValid) {
            console.error(`[DragDropController] У предмета "${original.itemId}" отсутствует или невалидна нода`);
            return false;
        }

        // Обновляем targetWorldPos перед спавном — на случай если onLoad сработал до
        // полной инициализации иерархии (prefab-инстансы в Slots-layer)
        original.node.active = true;
        original.targetWorldPos.set(original.node.worldPosition);
        console.log(`[DragDropController] targetWorldPos обновлён: "${original.itemId}" -> (${original.targetWorldPos.x.toFixed(0)},${original.targetWorldPos.y.toFixed(0)})`);

        // Клонируем ноду оригинала
        // Оригинал неактивен (node.active=false) — временно активируем для корректного instantiate
        const clone = instantiate(original.node);
        original.node.active = false;
        clone.name = `${original.node.name}_clone`;
        clone.active = true;

        // Помещаем в dragLayer ПЕРВЫМ — потом устанавливаем позицию
        const parent = this.dragLayer ?? this.node;
        clone.setParent(parent);

        // Стартовая позиция — бокс (устанавливаем ПОСЛЕ setParent)
        const boxWorldPos = this.boxNode?.worldPosition.clone() ?? new Vec3();
        clone.setWorldPosition(boxWorldPos.x, boxWorldPos.y, boxWorldPos.z);
        const placedScale = original.node.scale;
        const spawnScaleMul = this._getSpawnScaleForItem(original);
        clone.setScale(
            placedScale.x * spawnScaleMul,
            placedScale.y * spawnScaleMul,
            placedScale.z * spawnScaleMul,
        );
        if (this.spawnInstallParticles) {
            clone.getComponent(DraggableItem)?.playInstallParticles();
        }
        if (this.shakeCameraOnSpawn) {
            this._shakeCamera();
        }

        // Регистрируем клон
        this.activeClones.set(clone, original);
        this.missCount.set(clone, 0);

        // Конечная позиция — случайная точка внутри Fall-layer (по UITransform)
        const landPos = this._randomPosInFallLayer(boxWorldPos);

        console.log(`[DragDropController] Spawning: "${original.itemId}" (${this.currentIndex}/${this.itemSlots.length})`);

        // Звук появления предмета
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_ITEM_SPAWN });

        const cloneAnim = clone.getComponent(Animation);
        if (!cloneAnim) {
            console.warn(`[DragDropController] Animation не найден на клоне "${original.itemId}"`);
        }

        const spawnProgress = { t: 0 };
        tween(spawnProgress)
            .to(
                this.spawnMoveDuration,
                { t: 1 },
                {
                    easing: this._resolveEasing(this.spawnMoveEasing),
                    onUpdate: (target: { t: number }) => {
                        clone.setWorldPosition(this._getSpawnArcPosition(boxWorldPos, landPos, target.t));
                    },
                },
            )
            .call(() => {
                clone.setWorldPosition(landPos);
                console.log(`[DragDropController] Spawned: "${original.itemId}" — готов к drag`);
                GlobalEventBus.publish({ type: EVT_ITEM_SPAWNED, item: original, clone });

                // Рандомный начальный наклон: +floatTiltAngle или -floatTiltAngle
                const tilt = Math.random() < 0.5 ? this.floatTiltAngle : -this.floatTiltAngle;
                this.cloneTilt.set(clone, tilt);

                // Применяем наклон через tween на ноде Sprite
                this._applyTilt(clone, tilt);

                // Запускаем анимацию ItamFloatleft (покачивание Y на Sprite).
                // Анимация теперь содержит только трек Sprite/position — корневая нода не затрагивается.
                if (cloneAnim) {
                    cloneAnim.play('ItamFloatleft');
                }

                // Если missesBeforeHint = 0, показываем подсказку сразу
                if (this.missesBeforeHint === 0 && !original.isPlaced) {
                    original.playHologramHint();
                }
            })
            .start();
        return true;
    }

    // ─── Завершение игры ─────────────────────────────────────────────────────

    /** Проверяет все ли предметы размещены. Если да — показывает ctaNode */
    private _checkCompletion(): void {
        const validItems = this.itemSlots
            .filter(slot => this._isValidItemSlot(slot))
            .map(slot => slot.item);
        const placed = validItems.filter(item => item.isPlaced).length;
        const total = validItems.length;
        console.log(`[DragDropController] Completion check: ${placed}/${total} размещено. ctaNode=${!!this.ctaNode}`);
        this._trackAppLovinProgress(placed, total);

        if (this.debugCompleteAfterFirstPlacement && placed >= 1) {
            console.log('[DragDropController] DEBUG: завершение после первой установленной декорации');
            this._completeGame();
            return;
        }

        if (placed < total) return;

        console.log('[DragDropController] Все предметы размещены!');
        this._completeGame();
    }

    private _completeGame(): void {
        if (this._gameCompleted) return;
        this._gameCompleted = true;

        // Публикуем событие завершения игры
        GlobalEventBus.publish({ type: EVT_GAME_COMPLETE });
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_ROOM_COMPLETE });
        console.log('[DragDropController] EVT_GAME_COMPLETE опубликовано');
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private _repairItemSlotsIfNeeded(): void {
        this._migrateLegacyItemSlots();

        const validSerializedSlots = this.itemSlots.filter(slot => this._isValidItemSlot(slot));
        const slotsLayer = this._findChildDeep(this.node, 'Slots-layer');
        const sceneItems = slotsLayer
            ? slotsLayer.getComponentsInChildren(DraggableItem)
                .filter(item => this._isValidDraggableItem(item) && item.node !== slotsLayer)
            : [];

        if (sceneItems.length === 0) {
            this.itemSlots = validSerializedSlots;
            console.warn(`[DragDropController] Slots-layer не найден или не содержит DraggableItem. Валидных itemSlots: ${this.itemSlots.length}`);
            return;
        }

        const hasBrokenSerializedSlots = validSerializedSlots.length !== this.itemSlots.length;
        const hasIncompleteSerializedSlots = validSerializedSlots.length < sceneItems.length;

        if (hasBrokenSerializedSlots || hasIncompleteSerializedSlots) {
            this.itemSlots = sceneItems.map(item => this._wrapItemSlot(item));
            this.currentIndex = 0;
            console.log(`[DragDropController] itemSlots восстановлен из Slots-layer: ${this.itemSlots.length}`);
            return;
        }

        this.itemSlots = validSerializedSlots;
    }

    /** Старые сцены могли хранить в itemSlots ссылки на DraggableItem напрямую */
    private _migrateLegacyItemSlots(): void {
        if (this.itemSlots.length === 0) return;
        const first = this.itemSlots[0] as DraggableItemSlot | DraggableItem;
        if (!(first instanceof DraggableItem)) return;

        const legacyItems = this.itemSlots as unknown as DraggableItem[];
        this.itemSlots = legacyItems.map(item => this._wrapItemSlot(item));
        console.log(`[DragDropController] itemSlots мигрирован в DraggableItemSlot: ${this.itemSlots.length}`);
    }

    private _wrapItemSlot(item: DraggableItem, spawnScale = 1): DraggableItemSlot {
        const existing = this.itemSlots.find(slot => slot?.item === item);
        const slot = new DraggableItemSlot();
        slot.item = item;
        slot.spawnScale = existing?.spawnScale ?? spawnScale;
        return slot;
    }

    private _getSpawnScaleForItem(item: DraggableItem): number {
        for (const slot of this.itemSlots) {
            if (slot?.item === item) {
                return slot.spawnScale;
            }
        }
        return 1;
    }

    private _isValidItemSlot(slot: DraggableItemSlot | null | undefined): slot is DraggableItemSlot {
        return !!slot && this._isValidDraggableItem(slot.item);
    }

    private _isValidDraggableItem(item: DraggableItem | null | undefined): item is DraggableItem {
        return !!item && item instanceof DraggableItem && !!item.node && item.node.isValid;
    }

    private _findPlacementTarget(original: DraggableItem, clonePos: Vec3): DraggableItem | null {
        let nearest: DraggableItem | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;

        for (const slot of this.itemSlots) {
            if (!this._isValidItemSlot(slot)) continue;
            const candidate = slot.item;
            if (candidate.isPlaced) continue;
            if (candidate.itemId !== original.itemId) continue;

            const dist = Vec3.distance(candidate.targetWorldPos, clonePos);
            if (dist > candidate.snapRadius || dist >= nearestDist) continue;

            nearest = candidate;
            nearestDist = dist;
        }

        return nearest;
    }

    private _hasActiveCloneFor(original: DraggableItem): boolean {
        for (const [cloneNode, cloneOriginal] of this.activeClones) {
            if (cloneOriginal === original && cloneNode.isValid && cloneNode.active) {
                return true;
            }
        }

        return false;
    }

    private _findChildDeep(root: Node, name: string): Node | null {
        if (root.name === name) return root;

        for (const child of root.children) {
            const found = this._findChildDeep(child, name);
            if (found) return found;
        }

        return null;
    }

    /**
     * Возвращает случайную точку в world-пространстве внутри UITransform ноды fallLayer.
     * Если fallLayer не назначен — возвращает fallback (позиция бокса + 350px вверх).
     */
    private _randomPosInFallLayer(fallback: Vec3): Vec3 {
        const node = this.fallLayer;
        if (!node) {
            const spreadX = (Math.random() - 0.5) * 200;
            return new Vec3(fallback.x + spreadX, fallback.y + 350, fallback.z);
        }
        const uit = node.getComponent(UITransform);
        if (!uit) {
            const spreadX = (Math.random() - 0.5) * 200;
            return new Vec3(fallback.x + spreadX, fallback.y + 350, fallback.z);
        }
        // Получаем world-позицию центра ноды и размеры в world-единицах
        const worldCenter = node.worldPosition;
        const w = uit.width  * node.worldScale.x;
        const h = uit.height * node.worldScale.y;
        const rx = (Math.random() - 0.5) * w;
        const ry = (Math.random() - 0.5) * h;
        return new Vec3(worldCenter.x + rx, worldCenter.y + ry, fallback.z);
    }

    /**
     * Плавно поворачивает ноду Sprite клона на заданный угол (eulerAngles.z).
     * Анимация ItamFloatleft не трогает rotation корневой ноды — только Sprite.
     */
    private _applyTilt(cloneNode: Node, angleDeg: number): void {
        const spriteNode = cloneNode.getChildByName('Sprite');
        if (!spriteNode) return;
        const targetEuler = new Vec3(0, 0, angleDeg);
        tween(spriteNode)
            .to(this.tiltDuration, { eulerAngles: targetEuler }, { easing: 'quadOut' })
            .start();
    }

    private _alignCloneTiltToTarget(cloneNode: Node, target: DraggableItem): void {
        const cloneSpriteNode = cloneNode.getChildByName('Sprite');
        const targetSpriteNode = target.node.getChildByName('Sprite') ?? target.node;
        if (!cloneSpriteNode || !targetSpriteNode) return;

        tween(cloneSpriteNode)
            .to(
                this.placementMoveDuration,
                { eulerAngles: targetSpriteNode.eulerAngles.clone() },
                { easing: this._resolveEasing(this.placementMoveEasing) },
            )
            .start();
    }

    /** Конвертирует экранную точку касания в мировые координаты */
    private _touchToWorld(event: EventTouch): Vec3 {
        const loc = event.getLocation();
        const out = new Vec3();
        if (this.camera) {
            this.camera.screenToWorld(new Vec3(loc.x, loc.y, 0), out);
        } else {
            console.warn('[DragDropController] camera не назначена!');
        }
        return out;
    }

    /** Проверяет попадание точки в bounding box ноды */
    private _hitTestNode(node: Node | null, worldPos: Vec3): boolean {
        if (!node || !node.active) return false;
        const uiTransform = node.getComponent(UITransform);
        if (!uiTransform) return false;
        const bb = uiTransform.getBoundingBoxToWorld();
        return bb.contains(new Vec2(worldPos.x, worldPos.y));
    }

    /** Лёгкий эффект «прыжка» при успешном размещении — возвращается к исходному скейлу */
    private _playPlaceEffect(node: Node, originalScale: Vec3): void {
        const punch = Math.max(1, this.placementScalePunch);
        const bigScale = new Vec3(originalScale.x * punch, originalScale.y * punch, originalScale.z);
        tween(node)
            .to(this.placementScaleUpDuration, { scale: bigScale }, { easing: 'quadOut' })
            .to(this.placementScaleDownDuration, { scale: originalScale }, { easing: 'sineOut' })
            .start();
    }

    private _resolveEasing(easing: MotionEasing): (k: number) => number {
        switch (easing) {
            case MotionEasing.linear:
                return k => k;
            case MotionEasing.smooth:
                return k => k * k * (3 - 2 * k);
            case MotionEasing.quadInOut:
                return k => (k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k);
            case MotionEasing.sineOut:
                return k => Math.sin((k * Math.PI) / 2);
            case MotionEasing.backOut:
                return k => {
                    const c1 = 1.70158;
                    const c3 = c1 + 1;
                    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
                };
            case MotionEasing.quadOut:
            default:
                return k => k * (2 - k);
        }
    }

    private _getSpawnArcPosition(start: Vec3, end: Vec3, t: number): Vec3 {
        const clampedT = Math.max(0, Math.min(1, t));
        const oneMinusT = 1 - clampedT;
        const control = new Vec3(
            (start.x + end.x) * 0.5,
            Math.max(start.y, end.y) + this.spawnArcHeight,
            (start.z + end.z) * 0.5,
        );

        return new Vec3(
            oneMinusT * oneMinusT * start.x + 2 * oneMinusT * clampedT * control.x + clampedT * clampedT * end.x,
            oneMinusT * oneMinusT * start.y + 2 * oneMinusT * clampedT * control.y + clampedT * clampedT * end.y,
            oneMinusT * oneMinusT * start.z + 2 * oneMinusT * clampedT * control.z + clampedT * clampedT * end.z,
        );
    }

    private _trackAppLovinProgress(placed: number, total: number): void {
        if (total <= 0) return;

        const progress = placed / total;
        if (progress >= 0.75 && progress < 1) {
            AppLovinAnalytics.challengePass75();
        } else if (progress >= 0.5) {
            AppLovinAnalytics.challengePass50();
        } else if (progress >= 0.25) {
            AppLovinAnalytics.challengePass25();
        }
    }

    private _shakeCamera(): void {
        const shake = this.camera?.node.getComponent(CameraShake);
        shake?.shake();
    }
}
