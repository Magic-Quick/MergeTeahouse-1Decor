/**
 * super-html playable adapter
 * @help https://store.cocos.com/app/detail/3657
 *
 * @ccclass SuperHtmlPlayable — компонент на Canvas (для сериализации сцены).
 * Логика в shared PlayableLogic; Bootstrap и компонент используют один экземпляр.
 * Mintegral: window.install() + gameEnd.
 */

import { _decorator, Component } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_GAME_COMPLETE } from 'db://assets/scripts/common/events';
import { AppLovinAnalytics } from 'db://assets/scripts/core/AppLovinAnalytics';

const { ccclass } = _decorator;

// @ts-ignore
window['PLINKO_BUILD_MODE'] = window['PLINKO_BUILD_MODE'] || 'full';

export interface PlayableConfig {
    mode: 'full' | 'click' | 'time';
    clicks?: number;
    time?: number;
}

function resolveBuildType(): string {
    try {
        // @ts-ignore
        const params = new URLSearchParams(window.location.search);
        const urlMode = params.get('mode');
        if (urlMode) return urlMode;
    } catch (_e) { /* preview / editor */ }
    // @ts-ignore
    return (window['PLINKO_BUILD_MODE'] as string) || 'full';
}

export const BUILD_TYPE: string = resolveBuildType();

export function getConfig(): PlayableConfig {
    if (BUILD_TYPE === 'full') {
        return { mode: 'full' };
    }
    const clickMatch = BUILD_TYPE.match(/^(\d+)click$/);
    if (clickMatch) {
        return { mode: 'click', clicks: parseInt(clickMatch[1], 10) };
    }
    const timeMatch = BUILD_TYPE.match(/^(\d+)s$/);
    if (timeMatch) {
        return { mode: 'time', time: parseInt(timeMatch[1], 10) };
    }
    return { mode: 'full' };
}

export const CONFIG: PlayableConfig = getConfig();

class PlayableLogic {

    private _unsubscribeComplete: (() => void) | null = null;
    private _gameEndSent = false;

    start(): void {
        if (this._unsubscribeComplete) return;
        this._unsubscribeComplete = GlobalEventBus.subscribe(EVT_GAME_COMPLETE, () => {
            this.game_end();
        });
        console.log(`[SuperHtmlPlayable] start, режим: ${BUILD_TYPE}`);
    }

    stop(): void {
        this._unsubscribeComplete?.();
        this._unsubscribeComplete = null;
    }

    download(): void {
        AppLovinAnalytics.ctaClick();
        this._notifyGameEndBeforeStore();
        if (this._tryMintegralInstall()) {
            return;
        }
        // @ts-ignore
        if (window.super_html) {
            // @ts-ignore
            super_html.download();
        }
    }

    game_end(): void {
        if (this._gameEndSent) return;
        this._gameEndSent = true;
        console.log('[SuperHtmlPlayable] game_end');
        // @ts-ignore
        if (typeof window.gameEnd === 'function') {
            // @ts-ignore
            window.gameEnd();
        }
        // @ts-ignore
        if (window.super_html) {
            // @ts-ignore
            super_html.game_end();
        }
    }

    is_hide_download(): boolean {
        // @ts-ignore
        if (window.super_html && super_html.is_hide_download) {
            // @ts-ignore
            return super_html.is_hide_download();
        }
        return false;
    }

    set_google_play_url(url: string): void {
        // @ts-ignore
        if (window.super_html) {
            // @ts-ignore
            super_html.google_play_url = url;
        }
    }

    set_app_store_url(url: string): void {
        // @ts-ignore
        if (window.super_html) {
            // @ts-ignore
            super_html.appstore_url = url;
        }
    }

    is_audio(): boolean {
        // @ts-ignore
        return (window.super_html && super_html.is_audio()) || true;
    }

    private _notifyGameEndBeforeStore(): void {
        // @ts-ignore
        if (typeof window.gameEnd === 'function') {
            // @ts-ignore
            window.gameEnd();
        }
    }

    private _tryMintegralInstall(): boolean {
        // @ts-ignore
        if (typeof window.install === 'function') {
            // @ts-ignore
            window.install();
            return true;
        }
        // @ts-ignore
        if (typeof window.mintGameClose === 'function') {
            // @ts-ignore
            window.mintGameClose();
            return true;
        }
        return false;
    }
}

const playableLogic = new PlayableLogic();

/** Компонент на Canvas — нужен Cocos для сериализации (__type__: SuperHtmlPlayable) */
@ccclass('SuperHtmlPlayable')
export class SuperHtmlPlayable extends Component {

    onLoad(): void {
        playableLogic.start();
    }

    onDestroy(): void {
        playableLogic.stop();
    }
}

export const superHtmlPlayable = playableLogic;
export default playableLogic;
