import { _decorator, Component, Node, Camera } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import { AudioCatalog } from 'db://assets/scripts/audio/audio-catalog';
import { AudioController } from 'db://assets/scripts/audio/audio-controller';
import { GameConfig } from 'db://assets/scripts/game/game-config';
import { DragDropController } from 'db://assets/scripts/game/drag-drop-controller';

const { ccclass, property } = _decorator;

/**
 * Bootstrap — точка входа игры.
 * Вешается на корневую ноду сцены (Canvas).
 *
 * Инициализирует и связывает все системы:
 *   AudioController    → слушает EVT_PLAY_SOUND, воспроизводит клипы
 *   DragDropController → drag-and-drop предметов (получает камеру через init)
 *
 * DraggableItem-ы стоят прямо на сцене и сами знают свои targetWorldPos.
 * Никакой отдельной регистрации не требуется.
 *
 * TODO (раскомментировать по мере реализации):
 *   ChestController  → тап по шкатулке, спавн предметов
 *   GameLoop         → прогресс, EVT_ROOM_READY
 *   ScoreView        → счётчик монет
 *   TutorialView     → голографические силуэты
 *   CTAView          → финальный пекшот
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

    @property({ type: DragDropController, tooltip: 'DragDropController на сцене' })
    dragDropController: DragDropController | null = null;

    // ─── UI ──────────────────────────────────────────────────────────────────

    @property({ type: Node, tooltip: 'Нода счётчика монет (ScoreView)' })
    scoreNode: Node | null = null;

    @property({ type: Node, tooltip: 'Нода финального пекшота (CTAView)' })
    ctaNode: Node | null = null;

    // ─── Конфиг ──────────────────────────────────────────────────────────────

    @property({ type: GameConfig, tooltip: 'Конфигурация игры' })
    gameConfig: GameConfig | null = null;

    // ─── Приватные системы ───────────────────────────────────────────────────

    private audioController?: AudioController;

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    onLoad(): void {
        this._initAudio();
        this._initGame();
        this._initUI();
        console.log('[Bootstrap] Инициализация завершена');
    }

    onDestroy(): void {
        this.audioController?.stop();
        this.audioController = undefined;
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
        // Передаём камеру в DragDropController
        if (this.dragDropController && this.camera) {
            this.dragDropController.init(this.camera);
            console.log('[Bootstrap] DragDropController инициализирован');
        } else {
            if (!this.dragDropController) console.warn('[Bootstrap] dragDropController не назначен!');
            if (!this.camera) console.warn('[Bootstrap] camera не назначена!');
        }

        // TODO: ChestController
        // TODO: GameLoop
    }

    private _initUI(): void {
        if (this.ctaNode) {
            this.ctaNode.active = false;
        }
        // TODO: ScoreView, TutorialView, CTAView
    }
}
