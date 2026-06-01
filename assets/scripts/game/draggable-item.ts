import { _decorator, Component, Sprite, SpriteFrame, Vec3, Animation, Color, UITransform, ParticleSystem2D, Vec2 } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_PLAY_SOUND, SOUND_GROW, SOUND_WHOOSH } from 'db://assets/scripts/common/events';

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
        type: ParticleSystem2D,
        tooltip: 'ParticleSystem2D для эффекта установки предмета.',
    })
    installParticles: ParticleSystem2D | null = null;

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
        if (!this.node || !this.node.isValid) return;
        this.node.active = false;
    }

    /** Делает оригинал видимым (вызывается когда drag-копия успешно доставлена) */
    reveal(): void {
        if (this.isPlaced || !this.node || !this.node.isValid) return;
        this.isPlaced = true;
        this.node.active = true;
        this._setSpriteAlpha(255);
        // Запускаем анимацию установки предмета
        const anim = this.node.getComponent(Animation);
        if (anim) {
            anim.play('ItemInstall');
            console.log(`[DraggableItem] "${this.itemId}" — ItemInstall запущена`);
        }
        this.playInstallParticles();
        console.log(`[DraggableItem] "${this.itemId}" — размещён`);
    }

    /** Проигрывает одноразовый эффект появления/установки предмета. */
    playInstallParticles(): void {
        const particles = this.installParticles;
        if (!particles || !particles.node || !particles.node.isValid) return;

        const uiTransform = this.node.getComponent(UITransform);
        if (uiTransform) {
            particles.posVar = new Vec2(uiTransform.width * 0.7, uiTransform.height * 0.7);
        }

        particles.node.active = true;
        particles.stopSystem();
        particles.resetSystem();
    }

    /**
     * Запускает анимацию HologrammPulse на оригинале как подсказку.
     * Активирует ноду чтобы анимация была видна.
     * Вызывается из DragDropController после заданного количества промахов (missesBeforeHint).
     */
    playHologramHint(): void {
        if (this.isPlaced || !this.node || !this.node.isValid) return;
        const anim = this.node.getComponent(Animation);
        const state = anim?.getState('HologrammPulse') as { isPlaying?: boolean } | null | undefined;
        if (this._hologramPlaying && this.node.active && state?.isPlaying) return;

        this._setSpriteAlpha(0);
        this.node.active = true;
        if (anim) {
            this._hologramPlaying = true;
            anim.stop();
            anim.play('HologrammPulse');
            console.log(`[DraggableItem] "${this.itemId}" — HologrammPulse (подсказка)`);
        }
    }

    /** Скрывает оригинал и останавливает анимацию подсказки */
    stopHologramHint(): void {
        if (this.isPlaced || !this.node || !this.node.isValid) return;
        this._hologramPlaying = false;
        const anim = this.node.getComponent(Animation);
        if (anim) anim.stop();
        this._setSpriteAlpha(0);
        this.node.active = false;
    }

    /** Назначает спрайт предмету */
    setSpriteFrame(frame: SpriteFrame): void {
        if (this.spriteComp) {
            this.spriteComp.spriteFrame = frame;
        }
    }

    /** Вызывается из animation frame event с функцией Grow. */
    Grow(): void {
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_GROW });
    }

    /** Вызывается из animation frame event с функцией Whoosh. */
    Whoosh(): void {
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_WHOOSH });
    }

    private _setSpriteAlpha(alpha: number): void {
        if (!this.spriteComp) return;

        const color = this.spriteComp.color?.clone() ?? new Color(255, 255, 255, 255);
        color.a = alpha;
        this.spriteComp.color = color;
    }

}
