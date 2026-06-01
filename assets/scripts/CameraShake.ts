import { _decorator, Component, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

// Функция логирования
function log(message: string): void {
    console.log(message);
}

@ccclass('CameraShake')
export class CameraShake extends Component {

    @property
    public shakeDuration: number = 0.15;   // Длительность тряски (сек)

    @property
    public shakeIntensity: number = 5;      // Интенсивность (пикселей)

    @property
    public shakeFrequency: number = 0.02;  // Частота обновления (сек)

    protected originalPos: Vec3 = new Vec3();
    protected isShaking: boolean = false;
    protected timer: number = 0;

    start() {
        this.originalPos.set(this.node.position);
        log("[CameraShake] start: инициализация завершена");
    }

    /**
     * Запустить тряску камеры
     * @param duration - длительность (опционально, использует shakeDuration)
     * @param intensity - интенсивность (опционально, использует shakeIntensity)
     */
    public shake(duration?: number, intensity?: number) {
        const dur = duration ?? this.shakeDuration;
        const intens = intensity ?? this.shakeIntensity;

        this.stopShake();
        this.isShaking = true;
        this.timer = dur;
        this.originalPos.set(this.node.position);

        log(`[CameraShake] start: duration=${dur}, intensity=${intens}`);
    }

    update(dt: number) {
        if (!this.isShaking) return;

        this.timer -= dt;
        if (this.timer <= 0) {
            this.stopShake();
            return;
        }

        // Случайное смещение
        const offsetX = (Math.random() - 0.5) * this.shakeIntensity;
        const offsetY = (Math.random() - 0.5) * this.shakeIntensity;

        this.node.setPosition(
            this.originalPos.x + offsetX,
            this.originalPos.y + offsetY,
            this.originalPos.z
        );
    }

    protected stopShake() {
        this.isShaking = false;
        this.node.setPosition(this.originalPos);
        log("[CameraShake] stopShake: тряска завершена");
    }
}