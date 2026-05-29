import { _decorator, Component, Sprite, SpriteFrame, Vec3, Animation } from 'cc';

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
 * Анимации:
 *   HologrammPulse — на оригинале, запускается через 5 сек как подсказка
 *   ItamFloat      — на клоне, запускается когда клон ждёт перетаскивания
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

    /** true — анимация HologrammPulse уже запущена */
    private _hologramPlaying: boolean = false;

    /** ID предмета — берётся из имени назначенного спрайта */
    get itemId(): string {
        return this.spriteComp?.spriteFrame?.name ?? '';
    }

    onLoad(): void {
        // Запоминаем начальную world-позицию как целевую.
        // Используем scheduleOnce(0) чтобы дождаться полной инициализации иерархии сцены —
        // в onLoad() prefab-инстансы могут ещё не иметь корректных world-координат.
        this.scheduleOnce(() => {
            this.targetWorldPos.set(this.node.worldPosition);
            console.log(`[DraggableItem] "${this.itemId}" target=(${this.targetWorldPos.x.toFixed(0)},${this.targetWorldPos.y.toFixed(0)})`);
        }, 0);
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
        // Запускаем анимацию установки предмета
        const anim = this.node.getComponent(Animation);
        if (anim) {
            anim.play('ItemInstall');
            console.log(`[DraggableItem] "${this.itemId}" — ItemInstall запущена`);
        }
        console.log(`[DraggableItem] "${this.itemId}" — размещён`);
    }

    /**
     * Запускает анимацию HologrammPulse на оригинале как подсказку.
     * Активирует ноду чтобы анимация была видна.
     * Вызывается из DragDropController после 2 промахов.
     */
    playHologramHint(): void {
        if (this.isPlaced) return;
        this.node.active = true;
        // Не перезапускаем если анимация уже играет
        if (this._hologramPlaying) return;
        const anim = this.node.getComponent(Animation);
        if (anim) {
            this._hologramPlaying = true;
            anim.play('HologrammPulse');
            console.log(`[DraggableItem] "${this.itemId}" — HologrammPulse (подсказка)`);
        }
    }

    /** Скрывает оригинал и останавливает анимацию подсказки */
    stopHologramHint(): void {
        if (this.isPlaced) return;
        this._hologramPlaying = false;
        const anim = this.node.getComponent(Animation);
        if (anim) anim.stop();
        this.node.active = false;
    }

    /** Назначает спрайт предмету */
    setSpriteFrame(frame: SpriteFrame): void {
        if (this.spriteComp) {
            this.spriteComp.spriteFrame = frame;
        }
    }
}
