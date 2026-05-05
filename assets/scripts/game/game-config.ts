import { _decorator, Component } from 'cc';

const { ccclass, property } = _decorator;

/** Тип предмета — определяет, на какую зону его можно поставить */
export enum ItemType {
    FURNITURE = 'furniture',   // на пол
    WALL      = 'wall',        // на стену (окно, картина)
}

/** Описание одного предмета в последовательности */
export interface FurnitureItemConfig {
    id: string;
    type: ItemType;
    /** Ключ спрайта в каталоге ресурсов */
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

    /** Последовательность предметов задаётся в коде (или расширяется через инспектор позже) */
    getConfig(): IGameConfig {
        return {
            pointsPerPlacement: this.pointsPerPlacement,
            appStoreUrl: this.appStoreUrl,
            googlePlayUrl: this.googlePlayUrl,
            items: [
                { id: 'chair',   type: ItemType.FURNITURE, spriteKey: 'chair'   },
                { id: 'window',  type: ItemType.WALL,      spriteKey: 'window'  },
                { id: 'picture', type: ItemType.WALL,      spriteKey: 'picture' },
                { id: 'sofa',    type: ItemType.FURNITURE, spriteKey: 'sofa'    },
                { id: 'table',   type: ItemType.FURNITURE, spriteKey: 'table'   },
            ],
        };
    }
}
