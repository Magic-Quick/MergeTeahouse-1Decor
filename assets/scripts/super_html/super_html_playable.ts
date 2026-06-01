/**
 * super-html playable adapter
 * @help https://store.cocos.com/app/detail/3657
 * @home https://github.com/magician-f/cocos-playable-demo
 * @author https://github.com/magician-f
 *
 * Адаптирован для MergeTeahouseС1Decor:
 *   • game_end() вызывается автоматически при EVT_GAME_COMPLETE
 *   • Поддержка режимов: full, Nclick, Ns
 */

import { _decorator, Component } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import { EVT_GAME_COMPLETE } from 'db://assets/scripts/common/events';
import { AppLovinAnalytics } from 'db://assets/scripts/core/AppLovinAnalytics';

const { ccclass, property } = _decorator;

// =============================================================
// ТОЧКА КОНФИГУРАЦИИ
// Допустимые значения: "full" | "1click" | "2click" | "5click" | "15s" | "30s"
//
// КАК МЕНЯТЬ РЕЖИМ В СКОМПИЛИРОВАННОМ JS:
// Найди в JS-файле строку: PLINKO_BUILD_MODE="full"
// Замени "full" на нужный режим, например: PLINKO_BUILD_MODE="1click"
// =============================================================

// Эта переменная попадает в JS как есть (через window) и легко находится поиском
// @ts-ignore
window["PLINKO_BUILD_MODE"] = window["PLINKO_BUILD_MODE"] || "full";

export interface PlayableConfig {
    mode: 'full' | 'click' | 'time';
    clicks?: number;
    time?: number;
}

function resolveBuildType(): string {
    // Приоритет 1: URL-параметр ?mode=...
    try {
        // @ts-ignore
        const params = new URLSearchParams(window.location.search);
        const urlMode = params.get('mode');
        if (urlMode) return urlMode;
    } catch (e) {}
    // Приоритет 2: window["PLINKO_BUILD_MODE"] (можно менять в JS вручную)
    // @ts-ignore
    return (window["PLINKO_BUILD_MODE"] as string) || "full";
}

export const BUILD_TYPE: string = resolveBuildType();

export function getConfig(): PlayableConfig {
    if (BUILD_TYPE === 'full') {
        return { mode: 'full' };
    }
    // click-режимы: "1click", "2click", "5click", "10click", ...
    const clickMatch = BUILD_TYPE.match(/^(\d+)click$/);
    if (clickMatch) {
        return { mode: 'click', clicks: parseInt(clickMatch[1], 10) };
    }
    // time-режимы: "15s", "30s", "45s", ...
    const timeMatch = BUILD_TYPE.match(/^(\d+)s$/);
    if (timeMatch) {
        return { mode: 'time', time: parseInt(timeMatch[1], 10) };
    }
    // fallback — full
    return { mode: 'full' };
}

export const CONFIG: PlayableConfig = getConfig();

@ccclass('SuperHtmlPlayable')
export class SuperHtmlPlayable extends Component {

    private _unsubscribeComplete: (() => void) | null = null;

    onLoad(): void {
        // Подписываемся на завершение игры — автоматически вызываем game_end()
        this._unsubscribeComplete = GlobalEventBus.subscribe(EVT_GAME_COMPLETE, () => {
            this.game_end();
        });
        console.log(`[SuperHtmlPlayable] Режим: ${BUILD_TYPE}, подписка на EVT_GAME_COMPLETE`);
    }

    onDestroy(): void {
        this._unsubscribeComplete?.();
        this._unsubscribeComplete = null;
    }

    download() {
        // console.log("download"); // Отключено - функционал работает
        AppLovinAnalytics.ctaClick();
        // @ts-ignore
        window.super_html && super_html.download();
    }

    game_end() {
        console.log("[SuperHtmlPlayable] Game end — вызов window.super_html.game_end()");
        //@ts-ignore
        window.super_html && super_html.game_end();
    }

    /**
     * 是否隐藏下载按钮，意味着使用平台注入的下载按钮
     * channel : google
     */
    is_hide_download() {
        //@ts-ignore
        if (window.super_html && super_html.is_hide_download) {
            //@ts-ignore
            return super_html.is_hide_download();
        }
        return false
    }

    /**
     * 设置商店地址
     * channel : unity
     * @param url https://play.google.com/store/apps/details?id=com.unity3d.auicreativetestapp
     */
    set_google_play_url(url: string) {
        //@ts-ignore
        window.super_html && (super_html.google_play_url = url);
    }

    /**
     * 设置商店地址
     * channel : unity
     * @param url https://apps.apple.com/us/app/ad-testing/id1463016906
     */
    set_app_store_url(url: string) {
        //@ts-ignore
        window.super_html && (super_html.appstore_url = url);
    }

    /**
     * 是否开启声音
     * channel : ironsource
     */
    is_audio() {
        //@ts-ignore
        return (window.super_html && super_html.is_audio()) || true;
    }


}

// =============================================================
// Экспорт singleton для доступа из других скриптов
// =============================================================
export const superHtmlPlayable = new SuperHtmlPlayable();
export default superHtmlPlayable;