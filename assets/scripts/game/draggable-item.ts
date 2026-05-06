import { _decorator, Component, Sprite, SpriteFrame, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * DraggableItem — «оригинал» предмета, невидимо стоящий на своём месте в комнате.
 *
 * Жизненный цикл:
 *   1. onLoad() — запоминает свою world-позицию как targetWorldPos
 *   2. DragDropController.start() вызывает hide() — скрывает оригинал
 *   3. При тапе по боксу DragDropController клонирует ноду и анимирует вылет
 *   4. Когда клон подносится в радиус snapRadius — клон уничтожается, reveal() делает оригинал видимым
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
        console.log(`[DraggableItem] "${this.itemId}" target=(${this.targetWorldPos.x.toFixed(0)},${this.targetWorldPos.y.toFixed(0)})`);
    }

    /** Скрывает оригинал (вызывается из DragDropController.start()) */
    hide(): void {
        this.node.active = false;
    }

    /** Делает оригинал видимым (вызывается когда drag-копия успешно доставлена) */
    reveal(): void {
        if (this.isPlaced) return;
        this.isPlaced = true;
        this.node.active = true;
        console.log(`[DraggableItem] "${this.itemId}" — размещён`);
    }

    /** Назначает спрайт предмету */
    setSpriteFrame(frame: SpriteFrame): void {
        if (this.spriteComp) {
            this.spriteComp.spriteFrame = frame;
        }
    }
}
