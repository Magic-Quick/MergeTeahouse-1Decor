import {
    _decorator, Component, Node, Camera, Vec2, Vec3,
    EventTouch, UITransform, input, Input, tween, instantiate,
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
 *   • dragLayer — нода поверх всего; drag-копия живёт здесь
 *
 * Флоу:
 *   1. Тап по boxNode → берём itemSlots[currentIndex], клонируем ноду
 *   2. Клон вылетает из бокса и останавливается в случайной точке (готов к drag)
 *   3. Игрок тащит клон к месту оригинала
 *   4. При отпускании: если в радиусе оригинала → клон уничтожается, оригинал.reveal()
 *                      если промах → клон возвращается к боксу и уничтожается
 *   5. currentIndex++; следующий тап по боксу — следующий предмет
 */
@ccclass('DragDropController')
export class DragDropController extends Component {

    @property([DraggableItem])
    itemSlots: DraggableItem[] = [];

    @property({ type: Node, tooltip: 'Нода шкатулки (BoxClosed/BoxOpened)' })
    boxNode: Node | null = null;

    @property({ type: Node, tooltip: 'Drag-layer: последняя нода в Canvas, рисуется поверх всего' })
    dragLayer: Node | null = null;

    /** Камера передаётся из Bootstrap через init() */
    private camera: Camera | null = null;

    // ─── Состояние ───────────────────────────────────────────────────────────

    /** Индекс следующего предмета для выдачи из бокса */
    private currentIndex: number = 0;

    /** Активная drag-копия (null пока нет активного предмета) */
    private dragClone: Node | null = null;
    /** Оригинал, которому принадлежит текущая копия */
    private dragOriginal: DraggableItem | null = null;
    /** Смещение от центра ноды до точки касания */
    private touchOffset: Vec3 = new Vec3();
    /** Идёт ли сейчас drag */
    private isDragging: boolean = false;
    /** Идёт ли анимация вылета (клон ещё не готов к drag) */
    private isSpawning: boolean = false;

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    onLoad(): void {
        input.on(Input.EventType.TOUCH_START,  this._onTouchStart,  this);
        input.on(Input.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        input.on(Input.EventType.TOUCH_END,    this._onTouchEnd,    this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    start(): void {
        // Скрываем все оригиналы — они ждут своих drag-копий
        // start() вызывается после всех onLoad(), поэтому targetWorldPos уже записаны
        for (const item of this.itemSlots) {
            item.hide();
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

    init(camera: Camera): void {
        this.camera = camera;
    }

    // ─── Touch handlers ──────────────────────────────────────────────────────

    private _onTouchStart(event: EventTouch): void {
        const worldPos = this._touchToWorld(event);

        // Если есть готовый клон (не в анимации) — начинаем тащить его
        if (this.dragClone && !this.isDragging && !this.isSpawning) {
            const uiTransform = this.dragClone.getComponent(UITransform);
            if (uiTransform) {
                const bb = uiTransform.getBoundingBoxToWorld();
                if (bb.contains(new Vec2(worldPos.x, worldPos.y))) {
                    this.isDragging = true;
                    Vec3.subtract(this.touchOffset, this.dragClone.worldPosition, worldPos);
                    GlobalEventBus.publish({ type: EVT_ITEM_DRAG_START, item: this.dragOriginal });
                    console.log(`[DragDropController] Drag start: "${this.dragOriginal?.itemId}"`);
                    return;
                }
            }
        }

        // Тап по боксу — спавним следующий предмет (только если нет активного клона)
        const boxHit = this._hitTestNode(this.boxNode, worldPos);
        console.log(`[DragDropController] TouchStart: dragClone=${!!this.dragClone} isSpawning=${this.isSpawning} boxHit=${boxHit} idx=${this.currentIndex}/${this.itemSlots.length}`);
        if (!this.dragClone && !this.isSpawning && boxHit) {
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

    private _onTouchEnd(event: EventTouch): void {
        if (!this.isDragging || !this.dragClone || !this.dragOriginal) return;

        const original = this.dragOriginal;
        const clone = this.dragClone;

        // Сравниваем позицию клона (world space) с targetWorldPos оригинала (тоже world space)
        // Это надёжнее чем сравнивать позицию пальца — клон уже в правильной системе координат
        const clonePos = clone.worldPosition;
        const dist = Vec3.distance(original.targetWorldPos, clonePos);
        const inRadius = dist <= original.snapRadius;
        console.log(`[DragDropController] Drop check: clone=(${clonePos.x.toFixed(0)},${clonePos.y.toFixed(0)}) target=(${original.targetWorldPos.x.toFixed(0)},${original.targetWorldPos.y.toFixed(0)}) dist=${dist.toFixed(0)} radius=${original.snapRadius}`);

        this.isDragging = false;
        this.dragClone = null;
        this.dragOriginal = null;

        if (inRadius && !original.isPlaced) {
            // Успех: клон летит к цели, исчезает, оригинал появляется
            tween(clone)
                .to(0.15, { worldPosition: original.targetWorldPos })
                .call(() => {
                    clone.destroy();
                    original.reveal();
                    // Эффект прыжка — сохраняем исходный скейл оригинала
                    const origScale = original.node.scale.clone();
                    this._playPlaceEffect(original.node, origScale);
                })
                .start();

            GlobalEventBus.publish({ type: EVT_ITEM_PLACED, item: original });
            console.log(`[DragDropController] Placed: "${original.itemId}"`);
        } else {
            // Промах: клон остаётся там где его бросили — игрок может попробовать снова
            // Возвращаем ссылки чтобы клон оставался активным
            this.dragClone = clone;
            this.dragOriginal = original;

            GlobalEventBus.publish({ type: EVT_ITEM_WRONG_SLOT, item: original });
            console.log(`[DragDropController] Miss: "${original.itemId}" (dist=${dist.toFixed(0)}, radius=${original.snapRadius}) — клон остаётся`);
        }

        GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: original });
    }

    private _onTouchCancel(_event: EventTouch): void {
        if (this.isDragging && this.dragClone && this.dragOriginal) {
            const clone = this.dragClone;
            const original = this.dragOriginal;
            const boxWorldPos = this.boxNode?.worldPosition.clone() ?? new Vec3();

            this.isDragging = false;
            this.dragClone = null;
            this.dragOriginal = null;

            tween(clone)
                .to(0.25, { worldPosition: boxWorldPos })
                .call(() => { clone.destroy(); })
                .start();

            if (this.currentIndex > 0) this.currentIndex--;
            GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: original });
        }
    }

    // ─── Спавн предмета ──────────────────────────────────────────────────────

    private _spawnNextItem(): void {
        // Ищем следующий незанятый предмет (цикл вместо рекурсии — нет риска stack overflow)
        let original: DraggableItem | null = null;
        while (this.currentIndex < this.itemSlots.length) {
            const candidate = this.itemSlots[this.currentIndex];
            this.currentIndex++;
            if (!candidate.isPlaced) {
                original = candidate;
                break;
            }
        }

        if (!original) {
            console.log('[DragDropController] Все предметы уже выданы');
            return;
        }

        // Сохраняем в локальную переменную с явным типом для замыканий
        const item: DraggableItem = original;
        this.isSpawning = true;

        // Клонируем ноду оригинала
        // Оригинал неактивен (node.active=false) — временно активируем для корректного instantiate
        item.node.active = true;
        const clone = instantiate(item.node);
        item.node.active = false; // возвращаем в скрытое состояние
        clone.name = `${item.node.name}_clone`;
        clone.active = true;

        // Помещаем в dragLayer ПЕРВЫМ — потом устанавливаем позицию
        const parent = this.dragLayer ?? this.node;
        clone.setParent(parent);

        // Стартовая позиция — бокс (устанавливаем ПОСЛЕ setParent)
        const boxWorldPos = this.boxNode?.worldPosition.clone() ?? new Vec3();
        clone.setWorldPosition(boxWorldPos.x, boxWorldPos.y, boxWorldPos.z);

        // Конечная позиция — случайная точка выше бокса (игрок сам потащит к нужному месту)
        const spreadX = (Math.random() - 0.5) * 200; // ±100 px
        const landPos = new Vec3(
            boxWorldPos.x + spreadX,
            boxWorldPos.y + 350,
            boxWorldPos.z,
        );

        console.log(`[DragDropController] Spawning: "${item.itemId}" box=(${boxWorldPos.x.toFixed(0)},${boxWorldPos.y.toFixed(0)}) land=(${landPos.x.toFixed(0)},${landPos.y.toFixed(0)})`);

        tween(clone)
            .to(0.35, { worldPosition: landPos }, { easing: 'backOut' })
            .call(() => {
                // После вылета — предмет готов к перетаскиванию
                this.isSpawning = false;
                this.dragClone = clone;
                this.dragOriginal = item;
                console.log(`[DragDropController] Spawned: "${item.itemId}" — готов к drag`);
            })
            .start();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /** Конвертирует экранную точку касания в мировые координаты */
    private _touchToWorld(event: EventTouch): Vec3 {
        const loc = event.getLocation(); // экранные координаты (пиксели)
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
