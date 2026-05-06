import { _decorator, Component } from 'cc';

const { ccclass, property } = _decorator;

/** Описание одного предмета в последовательности */
export interface FurnitureItemConfig {
    /** Имя спрайта = ID предмета (chair, window, sofa…) */
    spriteKey: string;
}

/** Конфигурация всей игры */
export interface IGameConfig {
    /** Порядок предметов, вылетающих из шкатулки */
    items: FurnitureItemConfig[];
    /** Очки за каждое правильное размещение */
    pointsPerPlacement: number;
    /** Ссылка на App Store */
    appStoreUrl: string;
    /** Ссылка на Google Play */
    googlePlayUrl: string;
}

@ccclass('GameConfig')
export class GameConfig extends Component {

    @property({ tooltip: 'Очки за каждое правильное размещение' })
    pointsPerPlacement: number = 100;

    @property({ tooltip: 'App Store URL' })
    appStoreUrl: string = 'https://apps.apple.com/';

    @property({ tooltip: 'Google Play URL' })
    googlePlayUrl: string = 'https://play.google.com/';

    /** Последовательность предметов задаётся в коде */
    getConfig(): IGameConfig {
        return {
            pointsPerPlacement: this.pointsPerPlacement,
            appStoreUrl: this.appStoreUrl,
            googlePlayUrl: this.googlePlayUrl,
            items: [
                { spriteKey: 'chair'   },
                { spriteKey: 'window'  },
                { spriteKey: 'picture' },
                { spriteKey: 'sofa'    },
                { spriteKey: 'table'   },
            ],
        };
    }
}
