import { _decorator, Component } from 'cc';

const { ccclass, property } = _decorator;

/** Конфигурация игры */
@ccclass('GameConfig')
export class GameConfig extends Component {

    @property({ tooltip: 'App Store URL' })
    appStoreUrl: string = 'https://apps.apple.com/';

    @property({ tooltip: 'Google Play URL' })
    googlePlayUrl: string = 'https://play.google.com/';
}
