import { _decorator, Component, AudioClip } from 'cc';
import {
    SOUND_CHEST_TAP,
    SOUND_BOX_OPEN,
    SOUND_BOX_GET,
    SOUND_ITEM_SPAWN,
    SOUND_ITEM_PLACED,
    SOUND_WRONG_SLOT,
    SOUND_ROOM_COMPLETE,
    SOUND_COINS,
    SOUND_CONFETTI,
    SOUND_WIN_MENU_SHOWN,
    SOUND_CTA_SHOWN,
    SOUND_GROW,
    SOUND_WHOOSH,
} from 'db://assets/scripts/common/events';

const { ccclass, property } = _decorator;

/**
 * AudioCatalog — хранит ссылки на AudioClip-ассеты.
 * Назначается в инспекторе через drag-and-drop.
 * Не содержит логики воспроизведения — только данные.
 */
@ccclass('AudioCatalog')
export class AudioCatalog extends Component {

    @property({ type: AudioClip, tooltip: 'Тап по шкатулке' })
    chestTap: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость тапа по шкатулке' })
    chestTapVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Первое открытие коробки' })
    boxOpen: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость первого открытия коробки' })
    boxOpenVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Доставание предмета из уже открытой коробки' })
    boxGet: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость доставания из открытой коробки' })
    boxGetVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Вылет предмета из шкатулки' })
    itemSpawn: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость вылета предмета из шкатулки' })
    itemSpawnVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Дзинь — предмет встал на место' })
    itemPlaced: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость установки предмета' })
    itemPlacedVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Комната готова' })
    roomComplete: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость завершения комнаты' })
    roomCompleteVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Монеты летят к счётчику' })
    coins: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость монет' })
    coinsVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Конфетти / финал' })
    confetti: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость конфетти / финала' })
    confettiVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Появление меню выигрыша (WinMessage)' })
    winMenuShown: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость появления меню выигрыша' })
    winMenuShownVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Появление CTA' })
    ctaShown: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость появления CTA' })
    ctaShownVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Звук Grow для animation frame event' })
    grow: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость Grow' })
    growVolume: number = 1;

    @property({ type: AudioClip, tooltip: 'Звук Whoosh для animation frame event' })
    whoosh: AudioClip | null = null;

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Громкость Whoosh' })
    whooshVolume: number = 1;

    @property({
        type: [AudioClip],
        tooltip: 'Звуки, которые случайно проигрываются подряд во время перетаскивания предмета',
    })
    dragLoopClips: AudioClip[] = [];

    @property({ range: [0, 2, 0.01], slide: true, tooltip: 'Общая громкость звуков перетаскивания' })
    dragLoopVolume: number = 1;

    @property({ range: [0, 1, 0.01], slide: true, tooltip: 'Задержка остановки звука перетаскивания после прекращения движения, сек' })
    dragLoopStopDelay: number = 0.12;

    getClip(soundId: string): AudioClip | null {
        switch (soundId) {
            case SOUND_CHEST_TAP:     return this.chestTap;
            case SOUND_BOX_OPEN:      return this.boxOpen;
            case SOUND_BOX_GET:       return this.boxGet;
            case SOUND_ITEM_SPAWN:    return this.itemSpawn;
            case SOUND_ITEM_PLACED:   return this.itemPlaced;
            case SOUND_WRONG_SLOT:    return null;
            case SOUND_ROOM_COMPLETE: return this.roomComplete;
            case SOUND_COINS:         return this.coins;
            case SOUND_CONFETTI:      return this.confetti;
            case SOUND_WIN_MENU_SHOWN:return this.winMenuShown;
            case SOUND_CTA_SHOWN:     return this.ctaShown;
            case SOUND_GROW:          return this.grow;
            case SOUND_WHOOSH:        return this.whoosh;
            default:
                console.warn(`[AudioCatalog] Unknown soundId: "${soundId}"`);
                return null;
        }
    }

    getVolume(soundId: string): number {
        switch (soundId) {
            case SOUND_CHEST_TAP:     return this.chestTapVolume;
            case SOUND_BOX_OPEN:      return this.boxOpenVolume;
            case SOUND_BOX_GET:       return this.boxGetVolume;
            case SOUND_ITEM_SPAWN:    return this.itemSpawnVolume;
            case SOUND_ITEM_PLACED:   return this.itemPlacedVolume;
            case SOUND_ROOM_COMPLETE: return this.roomCompleteVolume;
            case SOUND_COINS:         return this.coinsVolume;
            case SOUND_CONFETTI:      return this.confettiVolume;
            case SOUND_WIN_MENU_SHOWN:return this.winMenuShownVolume;
            case SOUND_CTA_SHOWN:     return this.ctaShownVolume;
            case SOUND_GROW:          return this.growVolume;
            case SOUND_WHOOSH:        return this.whooshVolume;
            default:                  return 1;
        }
    }
}
