import { _decorator, Component, Sprite, SpriteFrame } from 'cc';
import { ItemType } from 'db://assets/scripts/game/game-config';

const { ccclass, property } = _decorator;

/**
 * DraggableItem — drag-копия предмета, создаётся при выпадении из шкатулки.
 *
 * ID предмета берётся из имени спрайта (spriteFrame.name), поэтому
 * отдельное поле itemId не нужно — имена спрайтов уникальны.
 *
 * Жизненный цикл:
 *   1. ChestController создаёт ноду из префаба и назначает spriteFrame
 *   2. Игрок тащит копию к нужному месту в комнате
 *   3. DragDropController находит RoomItem с совпадающим именем спрайта
 *   4. Копия уничтожается, RoomItem становится видимым
 */
@ccclass('DraggableItem')
export class DraggableItem extends Component {

    @property({
        tooltip: 'Тип зоны: "furniture" (пол) или "wall" (стена)',
    })
    itemType: string = ItemType.FURNITURE;

    @property({
        type: Sprite,
        tooltip: 'Sprite-компонент. Имя spriteFrame используется как ID предмета.',
    })
    spriteComp: Sprite | null = null;

    /** ID предмета — берётся из имени назначенного спрайта */
    get itemId(): string {
        return this.spriteComp?.spriteFrame?.name ?? '';
    }

    /** Назначает спрайт предмету */
    setSpriteFrame(frame: SpriteFrame): void {
        if (this.spriteComp) {
            this.spriteComp.spriteFrame = frame;
        }
    }
}
