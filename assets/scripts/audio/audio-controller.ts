import { AudioSource, AudioClip, Node } from 'cc';
import { IEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_ITEM_DRAG_END, EVT_ITEM_DRAG_MOVE, EVT_PLAY_SOUND } from 'db://assets/scripts/common/events';
import { AudioCatalog } from 'db://assets/scripts/audio/audio-catalog';

export interface AudioControllerOptions {
    bus: IEventBus;
    catalog: AudioCatalog | null | undefined;
    audioSourceParent: Node | null;
}

/**
 * AudioController — программно создаётся из Bootstrap и слушает события аудио.
 */
export class AudioController {
    private readonly bus: IEventBus;
    private readonly catalog: AudioCatalog | null | undefined;
    private readonly audioSourceParent: Node | null;
    private unsubs: Array<() => void> = [];
    private sfxSource: AudioSource | null = null;
    private readonly dragLoopPlayer: DragAudioLoopPlayer;

    constructor(opts: AudioControllerOptions) {
        this.bus = opts.bus;
        this.catalog = opts.catalog;
        this.audioSourceParent = opts.audioSourceParent;
        this.dragLoopPlayer = new DragAudioLoopPlayer(
            () => this.catalog,
            () => this.audioSourceParent,
        );
    }

    start(): void {
        this.unsubs.push(
            this.bus.subscribe<{ type: string; soundId: string }>(EVT_PLAY_SOUND, (e) => {
                this.play(e.soundId);
            }),
            this.bus.subscribe<{ type: string }>(EVT_ITEM_DRAG_MOVE, () => {
                this.dragLoopPlayer.notifyMovement();
            }),
            this.bus.subscribe<{ type: string }>(EVT_ITEM_DRAG_END, () => {
                this.dragLoopPlayer.stop();
            }),
        );
    }

    stop(): void {
        this.dragLoopPlayer.stop();
        for (const unsub of this.unsubs) unsub();
        this.unsubs.length = 0;
    }

    play(soundId: string): void {
        if (!this.catalog || !this.audioSourceParent) return;
        const clip = this.catalog.getClip(soundId);
        if (!clip) return;

        const src = this._getSfxSource();
        if (!src) return;

        src.playOneShot(clip, this.catalog.getVolume(soundId));
    }

    private _getSfxSource(): AudioSource | null {
        if (!this.audioSourceParent || !this.audioSourceParent.isValid) return null;

        if (!this.sfxSource || !this.sfxSource.node || !this.sfxSource.node.isValid) {
            this.sfxSource = this.audioSourceParent.addComponent(AudioSource);
        }
        return this.sfxSource;
    }
}

class DragAudioLoopPlayer {
    private source: AudioSource | null = null;
    private clipTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private isPlaying: boolean = false;
    private lastClip: AudioClip | null = null;

    constructor(
        private readonly getCatalog: () => AudioCatalog | null | undefined,
        private readonly getAudioSourceParent: () => Node | null | undefined,
    ) {}

    notifyMovement(): void {
        this._scheduleIdleStop();
        if (!this.isPlaying) {
            this.isPlaying = true;
            this._playNext();
        }
    }

    stop(): void {
        this.isPlaying = false;
        this._clearClipTimer();
        this._clearIdleTimer();
        if (this.source) {
            this.source.stop();
        }
    }

    private _playNext(): void {
        if (!this.isPlaying) return;

        const catalog = this.getCatalog();
        const clips = catalog?.dragLoopClips ?? [];
        if (clips.length === 0) return;

        const clip = this._pickRandomClip(clips);
        const source = this._getSource();
        if (!source) return;

        this.lastClip = clip;
        source.clip = clip;
        source.loop = false;
        source.volume = catalog?.dragLoopVolume ?? 1;
        source.play();

        this._clearClipTimer();
        this.clipTimer = setTimeout(() => {
            this._playNext();
        }, this._getClipDurationMs(clip));
    }

    private _getSource(): AudioSource | null {
        const parent = this.getAudioSourceParent();
        if (!parent || !parent.isValid) return null;

        if (!this.source || !this.source.node || !this.source.node.isValid) {
            this.source = parent.addComponent(AudioSource);
        }
        return this.source;
    }

    private _pickRandomClip(clips: AudioClip[]): AudioClip {
        if (clips.length === 1) return clips[0];

        let clip = clips[Math.floor(Math.random() * clips.length)];
        if (clip === this.lastClip) {
            const currentIndex = clips.indexOf(clip);
            clip = clips[(currentIndex + 1) % clips.length];
        }
        return clip;
    }

    private _getClipDurationMs(clip: AudioClip): number {
        const audioClip = clip as AudioClip & { getDuration?: () => number; duration?: number };
        const durationSeconds = audioClip.getDuration?.() ?? audioClip.duration ?? 0.25;
        return Math.max(50, durationSeconds * 1000);
    }

    private _scheduleIdleStop(): void {
        this._clearIdleTimer();
        const delaySeconds = this.getCatalog()?.dragLoopStopDelay ?? 0.12;
        this.idleTimer = setTimeout(() => {
            this.stop();
        }, Math.max(0, delaySeconds) * 1000);
    }

    private _clearClipTimer(): void {
        if (this.clipTimer === null) return;
        clearTimeout(this.clipTimer);
        this.clipTimer = null;
    }

    private _clearIdleTimer(): void {
        if (this.idleTimer === null) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }
}
