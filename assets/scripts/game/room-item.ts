import { _decorator, Component, Sprite, Color, tween, Vec3 } from 'cc';
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
 * Совпадение определяется только по itemId (имя спрайта).
 * ItemType убран — каждый предмет встаёт только в своё точное место.
 *
 * Регистрация в DragDropController выполняется из Bootstrap.
 */
@ccclass('RoomItem')
export class RoomItem extends Component {

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
        this._setOpacity(0);
    }

    // ─── Логика приёма предмета ──────────────────────────────────────────────

    /**
     * Проверяет совместимость drag-копии с этим слотом.
     * Единственное правило: ID (имя спрайта) должен совпадать.
     */
    canAccept(item: DraggableItem): boolean {
        if (this.isPlaced) return false;
        return item.itemId === this.itemId;
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

        // Лёгкий «прыжок» масштаба
        tween(this.node)
            .to(0.15, { scale: new Vec3(1.15, 1.15, 1) })
            .to(0.15, { scale: new Vec3(1, 1, 1) })
            .start();

        // Проявление + вспышка цвета
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
