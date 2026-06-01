import { _decorator, Component } from 'cc';

const { ccclass, property } = _decorator;

/** Конфигурация игры */
@ccclass('GameConfig')
export class GameConfig extends Component {

    @property({ tooltip: 'App Store URL' })
    appStoreUrl: string = 'https://apps.apple.com/';

    @property({ tooltip: 'Google Play URL' })
    googlePlayUrl: string = 'https://play.google.com/';

    @property({ tooltip: 'Задержка перед показом CTA после установки всех предметов (сек)' })
    ctaDelay: number = 3;

    @property({ tooltip: 'Количество неудачных попыток перед появлением голограммы-подсказки (0 = подсказка появляется сразу)' })
    missesBeforeHint: number = 2;

    @property({ tooltip: 'DEBUG: завершать игру после первой установленной декорации' })
    debugCompleteAfterFirstPlacement: boolean = false;
}
