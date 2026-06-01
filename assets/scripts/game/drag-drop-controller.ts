import {
    _decorator, Component, Node, Camera, Vec2, Vec3,
    EventTouch, UITransform, input, Input, tween, instantiate, Animation,
    ParticleSystem2D,
} from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import {
    EVT_ITEM_DRAG_START,
    EVT_ITEM_DRAG_END,
    EVT_ITEM_PLACED,
    EVT_ITEM_WRONG_SLOT,
    EVT_GAME_COMPLETE,
    EVT_PLAY_SOUND,
    SOUND_CHEST_TAP,
    SOUND_ITEM_SPAWN,
    SOUND_ITEM_PLACED,
    SOUND_WRONG_SLOT,
    SOUND_ROOM_COMPLETE,
} from 'db://assets/scripts/common/events';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const { ccclass, property } = _decorator;

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

    @property([DraggableItem])
    itemSlots: DraggableItem[] = [];

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

        // Скрываем все оригиналы — они ждут своих drag-копий
        for (const item of this.itemSlots) {
            if (this._isValidItemSlot(item)) {
                item.hide();
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
                    if (ps) ps.resetSystem(); // сбрасываем и запускаем эмиссию заново
                }

                // touchOffset от текущей worldPosition клона (с анимационным смещением)
                Vec3.subtract(this.touchOffset, cloneWorldPos, worldPos);

                GlobalEventBus.publish({ type: EVT_ITEM_DRAG_START, item: original });
                console.log(`[DragDropController] Drag start: "${original.itemId}"`);
                return;
            }
        }

        // Тап по боксу — спавним следующий предмет (без ограничений)
        if (this._hitTestNode(this.boxNode, worldPos)) {
            GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_CHEST_TAP });

            const spawned = this._spawnNextItem();
            if (!spawned) return;

            const boxAnim = this.boxNode?.getComponent(Animation);
            if (!boxAnim) return;

            // Первый спавн открывает коробку, следующие проигрывают короткую анимацию выдачи предмета.
            if (!this._boxOpenPlayed) {
                this._boxOpenPlayed = true;
                boxAnim.play('BoxOpen');
            } else {
                boxAnim.play('BoxGet');
            }
        }
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this.isDragging || !this.dragClone) return;
        const worldPos = this._touchToWorld(event);
        this.dragClone.setWorldPosition(
            worldPos.x + this.touchOffset.x,
            worldPos.y + this.touchOffset.y,
            this.dragClone.worldPosition.z,
        );
    }

    private _onTouchEnd(_event: EventTouch): void {
        if (!this.isDragging || !this.dragClone || !this.dragOriginal) return;

        const original = this.dragOriginal;
        const clone = this.dragClone;

        this.isDragging = false;
        this.dragClone = null;
        this.dragOriginal = null;

        // Останавливаем эмиссию новых частиц — существующие доигрывают цикл
        const particleNode = clone.getChildByName('ParticleDrug');
        if (particleNode) {
            const ps = particleNode.getComponent(ParticleSystem2D);
            if (ps) ps.stopSystem(); // прекращает создание новых частиц, живые доигрывают
        }

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
            tween(clone)
                .to(0.15, { worldPosition: placementTarget.targetWorldPos })
                .call(() => {
                    clone.destroy();
                    // Останавливаем HologrammPulse если он играл
                    original.stopHologramHint();
                    if (placementTarget !== original) {
                        placementTarget.stopHologramHint();
                    }
                    placementTarget.reveal(); // isPlaced = true здесь, node.active = true
                    if (placementTarget.node && placementTarget.node.isValid) {
                        const targetScale = placementTarget.node.scale.clone();
                        this._playPlaceEffect(placementTarget.node, targetScale);
                    }
                    // Проверяем завершение ПОСЛЕ reveal() — теперь isPlaced корректен
                    this._checkCompletion();
                })
                .start();

            GlobalEventBus.publish({ type: EVT_ITEM_PLACED, item: placementTarget });
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
            }
            GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: this.dragOriginal });
        }
        this.isDragging = false;
        this.dragClone = null;
        this.dragOriginal = null;
    }

    // ─── Спавн предмета ──────────────────────────────────────────────────────

    private _spawnNextItem(): boolean {
        // Ищем следующий незанятый предмет (цикл — нет риска stack overflow)
        let item: DraggableItem | null = null;
        while (this.currentIndex < this.itemSlots.length) {
            const candidate = this.itemSlots[this.currentIndex];
            this.currentIndex++;
            if (!candidate || !candidate.node || !candidate.node.isValid) {
                console.warn(`[DragDropController] itemSlots[${this.currentIndex - 1}] null или невалиден — пропускаем`);
                continue;
            }
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
        clone.getComponent(DraggableItem)?.playInstallParticles();

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

        tween(clone)
            .to(0.35, { worldPosition: landPos }, { easing: 'backOut' })
            .call(() => {
                console.log(`[DragDropController] Spawned: "${original.itemId}" — готов к drag`);

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
        const validItems = this.itemSlots.filter(item => this._isValidItemSlot(item));
        const placed = validItems.filter(item => item.isPlaced).length;
        const total = validItems.length;
        console.log(`[DragDropController] Completion check: ${placed}/${total} размещено. ctaNode=${!!this.ctaNode}`);

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
        // Публикуем событие завершения игры
        GlobalEventBus.publish({ type: EVT_GAME_COMPLETE });
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_ROOM_COMPLETE });
        console.log('[DragDropController] EVT_GAME_COMPLETE опубликовано');
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private _repairItemSlotsIfNeeded(): void {
        const validSerializedSlots = this.itemSlots.filter(item => this._isValidItemSlot(item));
        const slotsLayer = this._findChildDeep(this.node, 'Slots-layer');
        const sceneSlots = slotsLayer
            ? slotsLayer.getComponentsInChildren(DraggableItem)
                .filter(item => this._isValidItemSlot(item) && item.node !== slotsLayer)
            : [];

        if (sceneSlots.length === 0) {
            this.itemSlots = validSerializedSlots;
            console.warn(`[DragDropController] Slots-layer не найден или не содержит DraggableItem. Валидных itemSlots: ${this.itemSlots.length}`);
            return;
        }

        const hasBrokenSerializedSlots = validSerializedSlots.length !== this.itemSlots.length;
        const hasIncompleteSerializedSlots = validSerializedSlots.length < sceneSlots.length;

        if (hasBrokenSerializedSlots || hasIncompleteSerializedSlots) {
            this.itemSlots = sceneSlots;
            this.currentIndex = 0;
            console.log(`[DragDropController] itemSlots восстановлен из Slots-layer: ${this.itemSlots.length}`);
            return;
        }

        this.itemSlots = validSerializedSlots;
    }

    private _isValidItemSlot(item: DraggableItem | null | undefined): item is DraggableItem {
        return !!item && item instanceof DraggableItem && !!item.node && item.node.isValid;
    }

    private _findPlacementTarget(original: DraggableItem, clonePos: Vec3): DraggableItem | null {
        let nearest: DraggableItem | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;

        for (const candidate of this.itemSlots) {
            if (!this._isValidItemSlot(candidate)) continue;
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
        const bigScale = new Vec3(originalScale.x * 1.2, originalScale.y * 1.2, originalScale.z);
        tween(node)
            .to(0.1, { scale: bigScale })
            .to(0.15, { scale: originalScale })
            .start();
    }
}
