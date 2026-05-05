import { _decorator, Component, Sprite, Color, tween, Vec3 } from 'cc';
import { ItemType } from 'db://assets/scripts/game/game-config';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const { ccclass, property } = _decorator;

/**
 * RoomItem — предмет, заранее расставленный в изометрической комнате.
 *
 * Паттерн «двойник»:
 *   • Изначально невидим (opacity = 0), ждёт своего drag-двойника
 *   • Когда drag-копия подносится в радиус — копия уничтожается,
 *     RoomItem.place() проигрывает вспышку и делает предмет видимым
 *
 * Регистрация в DragDropController выполняется из Bootstrap,
 * чтобы избежать циклической зависимости.
 *
 * ID предмета берётся из имени спрайта (spriteComp.spriteFrame.name).
 * Тип зоны (FURNITURE / WALL) задаётся в инспекторе через выпадающий список.
 */
@ccclass('RoomItem')
export class RoomItem extends Component {

    @property({
        tooltip: 'Тип зоны: "furniture" (пол) или "wall" (стена)',
    })
    itemType: string = ItemType.FURNITURE;

    @property({
        type: Sprite,
        tooltip: 'Sprite-компонент. Имя spriteFrame = ID предмета.',
    })
    spriteComp: Sprite | null = null;

    /** Радиус захвата (world units). Если 0 — берётся из DragDropController */
    @property({ tooltip: 'Радиус захвата (0 = брать из DragDropController)' })
    snapRadius: number = 0;

    /** true — предмет уже размещён */
    isPlaced: boolean = false;

    /** ID предмета — имя назначенного спрайта */
    get itemId(): string {
        return this.spriteComp?.spriteFrame?.name ?? '';
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    onLoad(): void {
        // Скрываем предмет до момента размещения
        this._setOpacity(0);
    }

    // ─── Логика приёма предмета ──────────────────────────────────────────────

    /**
     * Проверяет совместимость drag-копии с этим слотом.
     * Правила:
     *   1. Ещё не размещён
     *   2. Тип зоны совпадает
     *   3. ID (имя спрайта) совпадает
     */
    canAccept(item: DraggableItem): boolean {
        if (this.isPlaced) return false;
        if (item.itemType !== this.itemType) return false;
        if (item.itemId !== this.itemId) return false;
        return true;
    }

    /**
     * Принимает предмет: проигрывает вспышку и делает себя видимым.
     * Drag-копию уничтожает вызывающий (DragDropController).
     */
    place(): void {
        if (this.isPlaced) return;
        this.isPlaced = true;
        this._playPlaceEffect();
        console.log(`[RoomItem] Размещён: "${this.itemId}"`);
    }

    // ─── Визуальные эффекты ──────────────────────────────────────────────────

    private _playPlaceEffect(): void {
        if (!this.spriteComp) {
            this._setOpacity(255);
            return;
        }

        // Проявление + лёгкий «прыжок» масштаба
        tween(this.node)
            .to(0.15, { scale: new Vec3(1.15, 1.15, 1) })
            .to(0.15, { scale: new Vec3(1, 1, 1) })
            .start();

        // Вспышка: делаем видимым и мигаем цветом
        this._setOpacity(255);
        const sprite = this.spriteComp;
        sprite.color = new Color(255, 255, 200, 255);
        tween(sprite)
            .to(0.2, { color: new Color(255, 255, 255, 255) })
            .start();
    }

    private _setOpacity(value: number): void {
        if (this.spriteComp) {
            const c = this.spriteComp.color.clone();
            c.a = value;
            this.spriteComp.color = c;
        }
    }
}
