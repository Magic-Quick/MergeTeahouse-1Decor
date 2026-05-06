import { _decorator, Component, Sprite, SpriteFrame, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * DraggableItem — предмет, который игрок перетаскивает по экрану.
 *
 * Упрощённая архитектура (без RoomItem):
 *   • Нода стоит на сцене в начальной позиции — это и есть целевая позиция
 *   • В onLoad() запоминает свою world-позицию как targetWorldPos
 *   • При дропе в радиусе snapRadius от targetWorldPos — предмет снапится на место
 *   • При промахе — возвращается на исходную позицию
 *
 * Назначение в инспекторе:
 *   spriteComp  — Sprite-компонент дочерней ноды
 *   snapRadius  — радиус захвата (world units)
 */
@ccclass('DraggableItem')
export class DraggableItem extends Component {

    @property({
        type: Sprite,
        tooltip: 'Sprite-компонент. Имя spriteFrame используется как ID предмета.',
    })
    spriteComp: Sprite | null = null;

    @property({
        tooltip: 'Радиус захвата (world units). При дропе в этом радиусе — снап на место.',
    })
    snapRadius: number = 80;

    /** Целевая позиция — запоминается автоматически в onLoad() из начальной позиции ноды */
    targetWorldPos: Vec3 = new Vec3();

    /** true — предмет уже размещён на своём месте */
    isPlaced: boolean = false;

    /** ID предмета — берётся из имени назначенного спрайта */
    get itemId(): string {
        return this.spriteComp?.spriteFrame?.name ?? '';
    }

    onLoad(): void {
        // Запоминаем начальную world-позицию как целевую
        this.targetWorldPos.set(this.node.worldPosition);
        console.log(`[DraggableItem] "${this.itemId}" target = ${JSON.stringify(this.targetWorldPos)}`);
    }

    /** Назначает спрайт предмету */
    setSpriteFrame(frame: SpriteFrame): void {
        if (this.spriteComp) {
            this.spriteComp.spriteFrame = frame;
        }
    }
}
