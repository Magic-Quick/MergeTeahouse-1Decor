import { _decorator, Component, Node, Camera, Vec2, Vec3, EventTouch, UITransform, input, Input, tween } from 'cc';
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
 * Упрощённая архитектура (без RoomItem):
 *   • DraggableItem стоят на сцене в начальных позициях
 *   • Каждый DraggableItem знает свою targetWorldPos и snapRadius
 *   • При дропе в радиусе — предмет снапится на targetWorldPos (анимация)
 *   • При промахе — предмет возвращается на исходную позицию (анимация)
 *
 * Назначение в инспекторе:
 *   dragLayer — нода-слой для перетаскиваемых объектов (рисуется поверх всего)
 *
 * Камера передаётся из Bootstrap через init().
 */
@ccclass('DragDropController')
export class DragDropController extends Component {

    /**
     * Drag-layer — пустая нода, расположенная последней в Canvas (рисуется поверх всего).
     * Назначается из инспектора.
     */
    @property({ type: Node, tooltip: 'Drag-layer: последняя нода в Canvas, рисуется поверх всего' })
    dragLayer: Node | null = null;

    /** Камера передаётся из Bootstrap через init() */
    private camera: Camera | null = null;

    // ─── Состояние drag ──────────────────────────────────────────────────────

    private activeDraggable: DraggableItem | null = null;
    private activeNode: Node | null = null;
    private originalParent: Node | null = null;
    private originalWorldPosition: Vec3 = new Vec3();
    private touchOffset: Vec3 = new Vec3();

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
     * Вызывается один раз в Bootstrap.onLoad().
     */
    init(camera: Camera): void {
        this.camera = camera;
    }

    // ─── Touch handlers ──────────────────────────────────────────────────────

    private _onTouchStart(event: EventTouch): void {
        const worldPos = this._touchToWorld(event);
        const hit = this._hitTestDraggable(worldPos);
        if (!hit) return;

        this.activeDraggable = hit;
        this.activeNode = hit.node;

        // Запоминаем исходные данные
        this.originalParent = this.activeNode.parent;
        this.originalWorldPosition.set(this.activeNode.worldPosition);

        // Смещение от центра ноды до точки касания (чтобы предмет не прыгал)
        Vec3.subtract(this.touchOffset, this.activeNode.worldPosition, worldPos);

        // Переносим в drag-layer — рисуется поверх всего
        if (this.dragLayer) {
            this.activeNode.setParent(this.dragLayer, true); // true = сохранить world transform
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
        const item = this.activeDraggable;

        // Проверяем попадание в радиус целевой позиции
        const dist = Vec3.distance(item.targetWorldPos, worldPos);
        const inRadius = dist <= item.snapRadius;

        if (inRadius && !item.isPlaced) {
            // Снапим предмет на целевую позицию
            item.isPlaced = true;

            // Возвращаем в исходный родитель перед снапом (чтобы позиция была корректной)
            if (this.originalParent) {
                this.activeNode.setParent(this.originalParent, true);
            }

            // Анимация снапа
            tween(this.activeNode)
                .to(0.15, { worldPosition: item.targetWorldPos })
                .call(() => {
                    this._playPlaceEffect(this.activeNode!);
                })
                .start();

            GlobalEventBus.publish({ type: EVT_ITEM_PLACED, item });
            console.log(`[DragDropController] Placed: "${item.itemId}" at target`);
        } else {
            // Промах — возвращаем на исходную позицию
            this._returnToOrigin();
            GlobalEventBus.publish({ type: EVT_ITEM_WRONG_SLOT, item });
            console.log(`[DragDropController] Miss: "${item.itemId}" (dist=${dist.toFixed(0)}, radius=${item.snapRadius})`);
        }

        GlobalEventBus.publish({ type: EVT_ITEM_DRAG_END, item });
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
        const loc = event.getLocation(); // экранные координаты (пиксели)
        const out = new Vec3();
        if (this.camera) {
            this.camera.screenToWorld(new Vec3(loc.x, loc.y, 0), out);
        } else {
            console.warn('[DragDropController] camera не назначена! Координаты будут (0,0,0)');
        }
        return out;
    }

    /**
     * Hit-test: ищет DraggableItem под точкой касания.
     * Перебирает все активные незанятые DraggableItem на сцене.
     */
    private _hitTestDraggable(worldPos: Vec3): DraggableItem | null {
        const candidates = this.node.scene?.getComponentsInChildren(DraggableItem) ?? [];
        console.log(`[DragDropController] HitTest worldPos=(${worldPos.x.toFixed(0)},${worldPos.y.toFixed(0)}) candidates=${candidates.length}`);
        for (const item of candidates) {
            if (!item.node.active) continue;
            if (item.isPlaced) continue; // уже размещён — не трогаем
            const uiTransform = item.node.getComponent(UITransform);
            if (!uiTransform) continue;
            const bb = uiTransform.getBoundingBoxToWorld();
            console.log(`[DragDropController]   "${item.itemId}" bb=(${bb.x.toFixed(0)},${bb.y.toFixed(0)},${bb.width.toFixed(0)}x${bb.height.toFixed(0)})`);
            if (bb.contains(new Vec2(worldPos.x, worldPos.y))) {
                return item;
            }
        }
        return null;
    }

    /** Возвращает drag-копию на исходную позицию с анимацией */
    private _returnToOrigin(): void {
        if (!this.activeNode || !this.originalParent) return;
        this.activeNode.setParent(this.originalParent, true);
        tween(this.activeNode)
            .to(0.2, { worldPosition: this.originalWorldPosition })
            .start();
    }

    /** Лёгкий эффект «прыжка» при успешном размещении */
    private _playPlaceEffect(node: Node): void {
        tween(node)
            .to(0.1, { scale: new Vec3(1.15, 1.15, 1) })
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private _clearDragState(): void {
        this.activeDraggable = null;
        this.activeNode = null;
        this.originalParent = null;
    }
}
