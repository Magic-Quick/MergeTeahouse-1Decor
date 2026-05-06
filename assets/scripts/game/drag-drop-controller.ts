import {
    _decorator, Component, Node, Camera, Vec2, Vec3,
    EventTouch, UITransform, input, Input, tween, instantiate, Animation,
} from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import {
    EVT_ITEM_DRAG_START,
    EVT_ITEM_DRAG_END,
    EVT_ITEM_PLACED,
    EVT_ITEM_WRONG_SLOT,
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
 * Решение конфликта анимации и drag:
 *   ItamFloat анимирует localPosition клона. При старте drag анимация останавливается,
 *   localPosition сбрасывается в (0,0,0), drag работает через worldPosition.
 *   При промахе анимация возобновляется.
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
        tooltip: 'Длительность плавного перехода клона из анимированной позиции в (0,0,0) при старте drag (сек). 0 — мгновенно.',
    })
    snapDuration: number = 0.12;

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
     * После 2 промахов запускается HologrammPulse на оригинале.
     */
    private missCount: Map<Node, number> = new Map();

    /**
     * Текущая float-анимация каждого клона ('ItamFloatleft' или 'ItamFloatRight').
     * При промахе переключается на альтернативную.
     */
    private cloneFloatAnim: Map<Node, string> = new Map();

    /** Доступные float-анимации */
    private static readonly FLOAT_ANIMS = ['ItamFloatleft', 'ItamFloatRight'] as const;

    /** Активная drag-копия (та что сейчас тащится) */
    private dragClone: Node | null = null;
    /** Оригинал, которому принадлежит текущая копия */
    private dragOriginal: DraggableItem | null = null;
    /** Смещение от центра ноды до точки касания */
    private touchOffset: Vec3 = new Vec3();
    /** Идёт ли сейчас drag */
    private isDragging: boolean = false;
    /**
     * true — клон выполняет snap-tween (localPosition → 0,0,0).
     * В этот момент _onTouchMove не двигает клон напрямую.
     */
    private isSnappingToDrag: boolean = false;

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    onLoad(): void {
        input.on(Input.EventType.TOUCH_START,  this._onTouchStart,  this);
        input.on(Input.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        input.on(Input.EventType.TOUCH_END,    this._onTouchEnd,    this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    start(): void {
        // Скрываем все оригиналы — они ждут своих drag-копий
        for (const item of this.itemSlots) {
            item.hide();
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

                // Запоминаем worldPosition клона ДО паузы анимации —
                // это текущая позиция с учётом анимационного смещения.
                const cloneWorldPos = cloneNode.worldPosition.clone();

                // Паузируем ItamFloat — анимация замирает в текущем кадре,
                // localPosition НЕ сбрасывается (в отличие от stop()).
                const cloneAnim = cloneNode.getComponent(Animation);
                if (cloneAnim) {
                    cloneAnim.pause();
                }

                // touchOffset от текущей (анимированной) worldPosition клона.
                // Клон остаётся там где был — без прыжков.
                Vec3.subtract(this.touchOffset, cloneWorldPos, worldPos);

                GlobalEventBus.publish({ type: EVT_ITEM_DRAG_START, item: original });
                console.log(`[DragDropController] Drag start: "${original.itemId}"`);
                return;
            }
        }

        // Тап по боксу — спавним следующий предмет (без ограничений)
        if (this._hitTestNode(this.boxNode, worldPos)) {
            this._spawnNextItem();
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
        this.isSnappingToDrag = false;
        this.dragClone = null;
        this.dragOriginal = null;

        // Сравниваем позицию клона с targetWorldPos оригинала (оба в world space)
        const clonePos = clone.worldPosition;
        const dist = Vec3.distance(original.targetWorldPos, clonePos);
        const inRadius = dist <= original.snapRadius;
        console.log(`[DragDropController] Drop: clone=(${clonePos.x.toFixed(0)},${clonePos.y.toFixed(0)}) target=(${original.targetWorldPos.x.toFixed(0)},${original.targetWorldPos.y.toFixed(0)}) dist=${dist.toFixed(0)} radius=${original.snapRadius}`);

        if (inRadius && !original.isPlaced) {
            // Успех: клон летит к цели, исчезает, оригинал появляется
            this.activeClones.delete(clone);
            this.missCount.delete(clone);
            this.cloneFloatAnim.delete(clone);
            tween(clone)
                .to(0.15, { worldPosition: original.targetWorldPos })
                .call(() => {
                    clone.destroy();
                    // Останавливаем HologrammPulse если он играл
                    original.stopHologramHint();
                    original.reveal(); // isPlaced = true здесь, node.active = true
                    const origScale = original.node.scale.clone();
                    this._playPlaceEffect(original.node, origScale);
                    // Проверяем завершение ПОСЛЕ reveal() — теперь isPlaced корректен
                    this._checkCompletion();
                })
                .start();

            GlobalEventBus.publish({ type: EVT_ITEM_PLACED, item: original });
            console.log(`[DragDropController] Placed: "${original.itemId}"`);
        } else {
            // Промах: клон остаётся там где его бросили, переключаем на альтернативную анимацию

            // Переключаем float-анимацию на противоположную (без повтора)
            const floatAnims = DragDropController.FLOAT_ANIMS;
            const currentAnim = this.cloneFloatAnim.get(clone) ?? floatAnims[0];
            const nextAnim = floatAnims.find(a => a !== currentAnim) ?? floatAnims[0];
            this.cloneFloatAnim.set(clone, nextAnim);

            const cloneAnim = clone.getComponent(Animation);
            if (cloneAnim) {
                cloneAnim.play(nextAnim);
                console.log(`[DragDropController] Float anim switch: "${nextAnim}" на "${original.itemId}"`);
            }

            // Считаем промахи — после 2 запускаем HologrammPulse на оригинале как подсказку
            const misses = (this.missCount.get(clone) ?? 0) + 1;
            this.missCount.set(clone, misses);
            console.log(`[DragDropController] Miss #${misses}: "${original.itemId}"`);

            if (misses >= 2 && !original.isPlaced) {
                original.playHologramHint();
            }

            GlobalEventBus.publish({ type: EVT_ITEM_WRONG_SLOT, item: original });
        }

        GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: original });
    }

    private _onTouchCancel(_event: EventTouch): void {
        if (this.isDragging && this.dragOriginal) {
            GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: this.dragOriginal });
        }
        this.isDragging = false;
        this.isSnappingToDrag = false;
        this.dragClone = null;
        this.dragOriginal = null;
    }

    // ─── Спавн предмета ──────────────────────────────────────────────────────

    private _spawnNextItem(): void {
        // Ищем следующий незанятый предмет (цикл — нет риска stack overflow)
        let item: DraggableItem | null = null;
        while (this.currentIndex < this.itemSlots.length) {
            const candidate = this.itemSlots[this.currentIndex];
            this.currentIndex++;
            if (!candidate.isPlaced) {
                item = candidate;
                break;
            }
        }

        if (!item) {
            console.log('[DragDropController] Все предметы уже выданы');
            return;
        }

        const original: DraggableItem = item;

        // Клонируем ноду оригинала
        // Оригинал неактивен (node.active=false) — временно активируем для корректного instantiate
        original.node.active = true;
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

        // Регистрируем клон
        this.activeClones.set(clone, original);
        this.missCount.set(clone, 0);

        // Конечная позиция — случайная точка выше бокса
        const spreadX = (Math.random() - 0.5) * 200; // ±100 px
        const landPos = new Vec3(
            boxWorldPos.x + spreadX,
            boxWorldPos.y + 350,
            boxWorldPos.z,
        );

        console.log(`[DragDropController] Spawning: "${original.itemId}" (${this.currentIndex}/${this.itemSlots.length})`);

        tween(clone)
            .to(0.35, { worldPosition: landPos }, { easing: 'backOut' })
            .call(() => {
                console.log(`[DragDropController] Spawned: "${original.itemId}" — готов к drag`);

                // Выбираем рандомную float-анимацию при спавне
                const floatAnims = DragDropController.FLOAT_ANIMS;
                const randomAnim = floatAnims[Math.floor(Math.random() * floatAnims.length)];
                this.cloneFloatAnim.set(clone, randomAnim);

                const cloneAnim = clone.getComponent(Animation);
                if (cloneAnim) {
                    cloneAnim.play(randomAnim);
                    console.log(`[DragDropController] Float anim: "${randomAnim}" на "${original.itemId}"`);
                } else {
                    console.warn(`[DragDropController] Animation не найден на клоне "${original.itemId}"`);
                }
            })
            .start();
    }

    // ─── Завершение игры ─────────────────────────────────────────────────────

    /** Проверяет все ли предметы размещены. Если да — показывает ctaNode */
    private _checkCompletion(): void {
        const placed = this.itemSlots.filter(item => item.isPlaced).length;
        const total = this.itemSlots.length;
        console.log(`[DragDropController] Completion check: ${placed}/${total} размещено. ctaNode=${!!this.ctaNode}`);

        if (placed < total) return;

        console.log('[DragDropController] Все предметы размещены! Показываем CTA');

        if (this.ctaNode) {
            const cta = this.ctaNode;
            // Небольшая задержка чтобы анимация последнего предмета успела отыграть
            this.scheduleOnce(() => {
                cta.setPosition(0, 0, 0);
                cta.active = true;
                console.log('[DragDropController] CTA активирована');
            }, 0.5);
        } else {
            console.warn('[DragDropController] ctaNode не назначена — CTA не появится');
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

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
