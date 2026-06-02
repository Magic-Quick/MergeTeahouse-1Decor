import { _decorator, Component, Node, Camera, Animation } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import { AudioCatalog } from 'db://assets/scripts/audio/audio-catalog';
import { AudioController } from 'db://assets/scripts/audio/audio-controller';
import { AppLovinAnalytics } from 'db://assets/scripts/core/AppLovinAnalytics';
import { GameConfig } from 'db://assets/scripts/game/game-config';
import { DragDropController } from 'db://assets/scripts/game/drag-drop-controller';
import superHtmlPlayable from 'db://assets/scripts/super_html/super_html_playable';
import {
    EVT_GAME_COMPLETE,
    EVT_PLAY_SOUND,
    SOUND_CTA_SHOWN,
    SOUND_WIN_MENU_SHOWN,
} from 'db://assets/scripts/common/events';

const { ccclass, property } = _decorator;

/**
 * Bootstrap — точка входа игры.
 * Вешается на корневую ноду сцены (Canvas).
 *
 * Инициализирует и связывает все системы:
 *   AudioController    → слушает EVT_PLAY_SOUND, воспроизводит клипы
 *   DragDropController → drag-and-drop предметов (получает камеру и ctaNode через init)
 */
@ccclass('Bootstrap')
export class Bootstrap extends Component {

    // ─── Сцена ───────────────────────────────────────────────────────────────

    @property({ type: Camera, tooltip: 'Основная камера сцены' })
    camera: Camera | null = null;

    // ─── Аудио ───────────────────────────────────────────────────────────────

    @property({ type: AudioCatalog, tooltip: 'Каталог звуков' })
    audioCatalog: AudioCatalog | null = null;

    @property({ type: Node, tooltip: 'Нода с AudioSource для SFX' })
    audioSourceParent: Node | null = null;

    // ─── Игровые объекты ─────────────────────────────────────────────────────

    @property({ type: Node, tooltip: 'Нода шкатулки' })
    chestNode: Node | null = null;

    @property({ type: Node, tooltip: 'Нода TapToDecorate (подсказка по тапу)' })
    tapToDecorateNode: Node | null = null;

    @property({ type: Node, tooltip: 'Нода RoomContainer (фон/комната)' })
    roomContainerNode: Node | null = null;

    @property({ type: DragDropController, tooltip: 'DragDropController на сцене' })
    dragDropController: DragDropController | null = null;

    // ─── UI ──────────────────────────────────────────────────────────────────

    @property({ type: Node, tooltip: 'Нода финального пекшота (CTAView)' })
    ctaNode: Node | null = null;

    @property({ type: Node, tooltip: 'Нода эффекта SparkStarsWalls (звёзды/конфетти при завершении игры)' })
    sparkStarsNode: Node | null = null;

    // ─── Конфиг ──────────────────────────────────────────────────────────────

    @property({ type: GameConfig, tooltip: 'Конфигурация игры' })
    gameConfig: GameConfig | null = null;

    // ─── Приватные системы ───────────────────────────────────────────────────

    private audioController?: AudioController;
    private winMessageNode: Node | null = null;

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    private _unsubscribeComplete: (() => void) | null = null;

    onLoad(): void {
        AppLovinAnalytics.impression();
        this._initAudio();
        this._initGame();
        this._subscribeToEvents();
        console.log('[Bootstrap] Инициализация завершена');
    }

    onDestroy(): void {
        this.audioController?.stop();
        this.audioController = undefined;
        this._unsubscribeComplete?.();
        this._unsubscribeComplete = null;
    }

    // ─── Инициализация ───────────────────────────────────────────────────────

    private _initAudio(): void {
        this.audioController = new AudioController({
            bus: GlobalEventBus,
            catalog: this.audioCatalog,
            audioSourceParent: this.audioSourceParent,
        });
        this.audioController.start();
        console.log('[Bootstrap] AudioController запущен');
    }

    private _initGame(): void {
        if (this.gameConfig) {
            superHtmlPlayable.set_app_store_url(this.gameConfig.appStoreUrl);
            superHtmlPlayable.set_google_play_url(this.gameConfig.googlePlayUrl);
        }

        // Скрываем SparkStarsWalls — показывается только при EVT_GAME_COMPLETE
        if (this.sparkStarsNode) {
            this.sparkStarsNode.active = false;
        }

        this.winMessageNode = this._findChildDeep(this.node, 'WinMessage');
        if (this.winMessageNode) {
            this.winMessageNode.active = false;
        }

        // Передаём камеру и ctaNode в DragDropController
        if (this.dragDropController && this.camera) {
            if (this.gameConfig) {
                this.dragDropController.ctaDelay = this.gameConfig.ctaDelay;
                this.dragDropController.missesBeforeHint = this.gameConfig.missesBeforeHint;
                this.dragDropController.debugCompleteAfterFirstPlacement = this.gameConfig.debugCompleteAfterFirstPlacement;
            }
            this.dragDropController.init(this.camera, this.ctaNode);
            console.log('[Bootstrap] DragDropController инициализирован');
        } else {
            if (!this.dragDropController) console.warn('[Bootstrap] dragDropController не назначен!');
            if (!this.camera) console.warn('[Bootstrap] camera не назначена!');
        }
    }

    private _subscribeToEvents(): void {
        this._unsubscribeComplete = GlobalEventBus.subscribe(EVT_GAME_COMPLETE, () => {
            this._onGameComplete();
        });
    }

    private _onGameComplete(): void {
        AppLovinAnalytics.win();
        this._showWinMessage();

        const ctaDelay = this.gameConfig?.ctaDelay ?? 0;
        this.scheduleOnce(() => {
            this._showCta();
        }, ctaDelay);
    }

    private _showCta(): void {
        if (this.ctaNode) {
            this.ctaNode.setPosition(0, 0, 0);
            this.ctaNode.active = true;
            GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_CTA_SHOWN });
            console.log('[Bootstrap] CTA активирована');
        } else {
            console.warn('[Bootstrap] ctaNode не назначена — CTA не появится');
        }

        if (this.sparkStarsNode) {
            this.sparkStarsNode.active = true;
            console.log('[Bootstrap] SparkStarsWalls активирован');
        }
    }

    private _showWinMessage(): void {
        const winMessageNode = this.winMessageNode ?? this._findChildDeep(this.node, 'WinMessage');

        if (!winMessageNode) {
            console.warn('[Bootstrap] WinMessage не найден');
            return;
        }

        winMessageNode.active = true;
        this._playIfExists(this.chestNode, 'BoxRemove', 'Chest.BoxRemove');
        this._playIfExists(this.tapToDecorateNode ?? this._findChildDeep(this.node, 'TapToDecorate'), 'TapToDecorateRemove', 'TapToDecorate.Remove');
        this._playIfExists(this.roomContainerNode ?? this._findChildDeep(this.node, 'RoomContainer'), 'RoomFocus', 'RoomContainer.RoomFocus');
        GlobalEventBus.publish({ type: EVT_PLAY_SOUND, soundId: SOUND_WIN_MENU_SHOWN });
        console.log('[Bootstrap] WinMessage активирован');
    }

    private _playIfExists(node: Node | null, clip: string, label: string): void {
        if (!node || !node.isValid) return;
        const anim = node.getComponent(Animation);
        if (!anim) return;
        anim.stop();
        anim.play(clip);
        console.log(`[Bootstrap] ${label}: ${clip}`);
    }

    private _playWinMessageExit(): void {
        const winMessageNode = this.winMessageNode ?? this._findChildDeep(this.node, 'WinMessage');
        const anim = winMessageNode?.getComponent(Animation);

        if (!winMessageNode || !anim) {
            console.warn('[Bootstrap] WinMessageExit не запущена: WinMessage/Animation не найден');
            return;
        }

        winMessageNode.active = true;
        anim.stop();
        anim.play('WinMessageExit');
        console.log('[Bootstrap] WinMessageExit запущена');
    }

    private _findChildDeep(root: Node, name: string): Node | null {
        if (root.name === name) return root;

        for (const child of root.children) {
            const found = this._findChildDeep(child, name);
            if (found) return found;
        }

        return null;
    }
}
