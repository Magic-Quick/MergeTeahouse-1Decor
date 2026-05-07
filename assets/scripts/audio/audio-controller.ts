import { _decorator, Component, AudioSource, AudioClip } from 'cc';
import { GlobalEventBus, IEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_PLAY_SOUND } from 'db://assets/scripts/common/events';
import { AudioCatalog } from 'db://assets/scripts/audio/audio-catalog';

const { ccclass, property } = _decorator;

/**
 * AudioController — Cocos-компонент для воспроизведения звуков по событиям шины.
 *
 * Архитектура (event-driven):
 *   GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: "chest_tap" })
 *         ↓
 *   AudioController (подписан на EVT_PLAY_SOUND в onLoad())
 *         ↓
 *   AudioCatalog.getClip("chest_tap") → возвращает AudioClip
 *         ↓
 *   AudioSource.playOneShot(clip) → звук воспроизводится
 *
 * Использование в редакторе:
 *   1. Повесить этот компонент на любую ноду сцены
 *   2. В инспекторе назначить audioCatalog (ссылка на AudioCatalog)
 *   3. Звуки воспроизводятся через GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: ... })
 */
@ccclass('AudioController')
export class AudioController extends Component {

    @property({ type: AudioCatalog, tooltip: 'Каталог звуков (AudioCatalog)' })
    audioCatalog: AudioCatalog | null = null;

    private unsubs: Array<() => void> = [];

    onLoad(): void {
        // Подписываемся на шину событий
        this.unsubs.push(
            GlobalEventBus.subscribe<{ type: string; soundId: string }>(EVT_PLAY_SOUND, (e) => {
                this.play(e.soundId);
            }),
        );
    }

    onDestroy(): void {
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
    }

    /**
     * Воспроизвести звук по soundId.
     * @param soundId — идентификатор звука (например, "chest_tap", "item_placed")
     */
    play(soundId: string): void {
        if (!this.audioCatalog) {
            console.warn(`[AudioController] audioCatalog не назначен`);
            return;
        }

        const clip = this.audioCatalog.getClip(soundId);
        if (!clip) {
            console.warn(`[AudioController] Звук не найден: "${soundId}"`);
            return;
        }

        // Получаем или создаём AudioSource на этой ноде
        let src = this.getComponent(AudioSource);
        if (!src) {
            src = this.addComponent(AudioSource);
        }

        src.playOneShot(clip);
    }
}

// ─── Legacy-класс для обратной совместимости с Bootstrap ──────────────────────

export interface AudioControllerOptions {
    bus: IEventBus;
    catalog: AudioCatalog | null | undefined;
    audioSourceParent: Component['node'] | null;
}

/**
 * Legacy AudioController — используется Bootstrap для программной инициализации.
 * Bootstrap создаёт его через new AudioControllerLegacy(opts).start()
 */
export class AudioControllerLegacy {
    private readonly bus: IEventBus;
    private readonly catalog: AudioCatalog | null | undefined;
    private readonly audioSourceParent: Component['node'] | null;
    private unsubs: Array<() => void> = [];

    constructor(opts: AudioControllerOptions) {
        this.bus = opts.bus;
        this.catalog = opts.catalog;
        this.audioSourceParent = opts.audioSourceParent;
    }

    start(): void {
        this.unsubs.push(
            this.bus.subscribe<{ type: string; soundId: string }>(EVT_PLAY_SOUND, (e) => {
                this.play(e.soundId);
            }),
        );
    }

    stop(): void {
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
    }

    play(soundId: string): void {
        if (!this.catalog || !this.audioSourceParent) return;
        const clip = this.catalog.getClip(soundId);
        if (!clip) return;

        const src = this.audioSourceParent.getComponent(AudioSource)
            ?? this.audioSourceParent.addComponent(AudioSource);
        src.playOneShot(clip);
    }
}
