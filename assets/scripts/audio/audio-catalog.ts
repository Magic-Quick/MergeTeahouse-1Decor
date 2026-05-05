import { _decorator, Component, AudioClip } from 'cc';
import {
    SOUND_CHEST_TAP,
    SOUND_ITEM_SPAWN,
    SOUND_ITEM_PLACED,
    SOUND_WRONG_SLOT,
    SOUND_ROOM_COMPLETE,
    SOUND_COINS,
    SOUND_CONFETTI,
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

    @property({ type: AudioClip, tooltip: 'Вылет предмета из шкатулки' })
    itemSpawn: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'Дзинь — предмет встал на место' })
    itemPlaced: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'Неверный слот' })
    wrongSlot: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'Комната готова' })
    roomComplete: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'Монеты летят к счётчику' })
    coins: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'Конфетти / финал' })
    confetti: AudioClip | null = null;

    getClip(soundId: string): AudioClip | null {
        switch (soundId) {
            case SOUND_CHEST_TAP:     return this.chestTap;
            case SOUND_ITEM_SPAWN:    return this.itemSpawn;
            case SOUND_ITEM_PLACED:   return this.itemPlaced;
            case SOUND_WRONG_SLOT:    return this.wrongSlot;
            case SOUND_ROOM_COMPLETE: return this.roomComplete;
            case SOUND_COINS:         return this.coins;
            case SOUND_CONFETTI:      return this.confetti;
            default:
                console.warn(`[AudioCatalog] Unknown soundId: "${soundId}"`);
                return null;
        }
    }
}
