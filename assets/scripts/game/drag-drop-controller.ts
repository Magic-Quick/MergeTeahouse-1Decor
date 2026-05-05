import { _decorator, Component, Node, Camera, Vec2, Vec3, EventTouch, UITransform, input, Input } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import {
    EVT_ITEM_DRAG_START,
    EVT_ITEM_DRAG_END,
    EVT_ITEM_DROP_ATTEMPT,
    EVT_ITEM_PLACED,
    EVT_ITEM_WRONG_SLOT,
} from 'db://assets/scripts/common/events';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';
import { RoomItem } from 'db://assets/scripts/game/room-item';

const { ccclass, property } = _decorator;

/**
 * DragDropController — компонент на корневой ноде сцены.
 *
 * Паттерн «двойник»:
 *   • RoomItem расставлены в комнате заранее, изначально невидимы
 *   • При выпадении из шкатулки ChestController создаёт drag-копию (DraggableItem)
 *   • Игрок тащит копию; при отпускании контроллер ищет ближайший RoomItem
 *   • Если совпадение — копия уничтожается, RoomItem.place() делает его видимым
 *   • Если промах — копия возвращается на исходную позицию
 *
 * Назначение в инспекторе:
 *   camera     — основная камера
 *   dragLayer  — нода-слой для перетаскиваемых объектов (рисуется поверх всего)
 *   snapRadius — радиус захвата слота (world units)
 */
@ccclass('DragDropController')
export class DragDropController extends Component {

    /**
     * Drag-layer — пустая нода, расположенная последней в Canvas (рисуется поверх всего).
     * Назначается из Bootstrap через init() или через инспектор.
     *
     * Структура сцены:
     *   Canvas
     *     ├── Background
     *     ├── Room
     *     ├── UI
     *     └── DragLayer  ← сюда временно переносится предмет во время drag
     */
    @property({ type: Node, tooltip: 'Drag-layer: последняя нода в Canvas, рисуется поверх всего' })
    dragLayer: Node | null = null;

    @property({ tooltip: 'Радиус захвата RoomItem (world units)' })
    snapRadius: number = 80;

    /** Камера передаётся из Bootstrap через init() — не дублируем @property */
    private camera: Camera | null = null;

    // ─── Состояние drag ──────────────────────────────────────────────────────

    private activeDraggable: DraggableItem | null = null;
    private activeNode: Node | null = null;
    private originalParent: Node | null = null;
    private originalPosition: Vec3 = new Vec3();
    private touchOffset: Vec3 = new Vec3();

    private registeredRoomItems: RoomItem[] = [];

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    onLoad(): void {
        input.on(Input.EventType.TOUCH_START,  this._onTouchStart,  this);
        input.on(Input.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        input.on(Input.EventType.TOUCH_END,    this._onTouchEnd,    this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.TOUCH_START,  this._onTouchStart,  this);
        input.off(Input.EventType.TOUCH_MOVE,   this._onTouchMove,   this);
        input.off(Input.EventType.TOUCH_END,    this._onTouchEnd,    this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    // ─── Инициализация ───────────────────────────────────────────────────────

    /**
     * Передаёт камеру из Bootstrap.
     * Вызывается один раз в Bootstrap.onLoad() после получения компонента.
     */
    init(camera: Camera): void {
        this.camera = camera;
    }

    // ─── Регистрация RoomItem ────────────────────────────────────────────────

    /** Вызывается из RoomItem.onLoad() */
    registerRoomItem(item: RoomItem): void {
        if (this.registeredRoomItems.indexOf(item) === -1) {
            this.registeredRoomItems.push(item);
        }
    }

    unregisterRoomItem(item: RoomItem): void {
        const idx = this.registeredRoomItems.indexOf(item);
        if (idx !== -1) this.registeredRoomItems.splice(idx, 1);
    }

    // ─── Touch handlers ──────────────────────────────────────────────────────

    private _onTouchStart(event: EventTouch): void {
        const worldPos = this._touchToWorld(event);
        const hit = this._hitTestDraggable(worldPos);
        if (!hit) return;

        this.activeDraggable = hit;
        this.activeNode = hit.node;

        this.originalParent = this.activeNode.parent;
        this.originalPosition.set(this.activeNode.position);

        // Смещение от центра ноды до точки касания (чтобы предмет не прыгал)
        Vec3.subtract(this.touchOffset, this.activeNode.worldPosition, worldPos);

        // Переносим в drag-layer — рисуется поверх всего
        if (this.dragLayer) {
            this.activeNode.setParent(this.dragLayer);
        }

        GlobalEventBus.publish({ type: EVT_ITEM_DRAG_START, item: this.activeDraggable });
        console.log(`[DragDropController] Drag start: "${this.activeDraggable.itemId}"`);
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this.activeNode) return;
        const worldPos = this._touchToWorld(event);
        this.activeNode.setWorldPosition(
            worldPos.x + this.touchOffset.x,
            worldPos.y + this.touchOffset.y,
            this.activeNode.worldPosition.z,
        );
    }

    private _onTouchEnd(event: EventTouch): void {
        if (!this.activeDraggable || !this.activeNode) return;

        const worldPos = this._touchToWorld(event);
        const roomItem = this._findNearestRoomItem(worldPos, this.activeDraggable);

        if (roomItem) {
            GlobalEventBus.publish({
                type: EVT_ITEM_DROP_ATTEMPT,
                item: this.activeDraggable,
                roomItemId: roomItem.itemId,
            });

            // Уничтожаем drag-копию, активируем RoomItem
            roomItem.place();
            this.activeNode.destroy();
            this.activeNode = null;

            GlobalEventBus.publish({
                type: EVT_ITEM_PLACED,
                item: this.activeDraggable,
                roomItemId: roomItem.itemId,
            });
            console.log(`[DragDropController] Placed: "${this.activeDraggable.itemId}"`);
        } else {
            // Промах — возвращаем на место
            this._returnToOrigin();
            GlobalEventBus.publish({
                type: EVT_ITEM_WRONG_SLOT,
                item: this.activeDraggable,
            });
            console.log(`[DragDropController] Miss: "${this.activeDraggable.itemId}"`);
        }

        GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: this.activeDraggable });
        this._clearDragState();
    }

    private _onTouchCancel(_event: EventTouch): void {
        if (this.activeDraggable) {
            this._returnToOrigin();
            GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item: this.activeDraggable });
        }
        this._clearDragState();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /** Конвертирует экранную точку касания в мировые координаты */
    private _touchToWorld(event: EventTouch): Vec3 {
        const loc = event.getUILocation();
        const out = new Vec3();
        if (this.camera) {
            this.camera.screenToWorld(new Vec3(loc.x, loc.y, 0), out);
        }
        return out;
    }

    /**
     * Hit-test: ищет DraggableItem под точкой касания.
     * Перебирает все активные DraggableItem на сцене.
     */
    private _hitTestDraggable(worldPos: Vec3): DraggableItem | null {
        const candidates = this.node.scene?.getComponentsInChildren(DraggableItem) ?? [];
        for (const item of candidates) {
            if (!item.node.active) continue;
            const uiTransform = item.node.getComponent(UITransform);
            if (!uiTransform) continue;
            const bb = uiTransform.getBoundingBoxToWorld();
            if (bb.contains(new Vec2(worldPos.x, worldPos.y))) {
                return item;
            }
        }
        return null;
    }

    /**
     * Ищет ближайший незанятый RoomItem, который может принять данный предмет.
     * Учитывает snapRadius самого RoomItem (если > 0) или глобальный snapRadius.
     */
    private _findNearestRoomItem(worldPos: Vec3, item: DraggableItem): RoomItem | null {
        let nearest: RoomItem | null = null;
        let minDist = Infinity;

        for (const roomItem of this.registeredRoomItems) {
            if (!roomItem.canAccept(item)) continue;
            const radius = roomItem.snapRadius > 0 ? roomItem.snapRadius : this.snapRadius;
            const dist = Vec3.distance(roomItem.node.worldPosition, worldPos);
            if (dist < radius && dist < minDist) {
                minDist = dist;
                nearest = roomItem;
            }
        }
        return nearest;
    }

    /** Возвращает drag-копию на исходную позицию */
    private _returnToOrigin(): void {
        if (!this.activeNode || !this.originalParent) return;
        this.activeNode.setParent(this.originalParent);
        this.activeNode.setPosition(this.originalPosition);
    }

    private _clearDragState(): void {
        this.activeDraggable = null;
        this.activeNode = null;
        this.originalParent = null;
    }
}
