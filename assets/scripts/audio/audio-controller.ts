import { AudioSource } from 'cc';
import { IEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_PLAY_SOUND } from 'db://assets/scripts/common/events';
import { AudioCatalog } from 'db://assets/scripts/audio/audio-catalog';

interface AudioControllerOptions {
    bus: IEventBus;
    catalog: AudioCatalog | null | undefined;
    audioSourceParent: import('cc').Node | null;
}

export class AudioController {
    private readonly bus: IEventBus;
    private readonly catalog: AudioCatalog | null | undefined;
    private readonly audioSourceParent: import('cc').Node | null;
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
