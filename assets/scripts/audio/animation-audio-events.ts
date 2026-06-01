import { _decorator, Component } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_PLAY_SOUND, SOUND_GROW, SOUND_WHOOSH } from 'db://assets/scripts/common/events';

const { ccclass } = _decorator;

/**
 * Methods for Cocos animation frame events that only need to trigger audio.
 * Attach this component to the same node that owns the Animation component.
 */
@ccclass('AnimationAudioEvents')
export class AnimationAudioEvents extends Component {
    Grow(): void {
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_GROW });
    }

    Whoosh(): void {
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_WHOOSH });
    }
}
