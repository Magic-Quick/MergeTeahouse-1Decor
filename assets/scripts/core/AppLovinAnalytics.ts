/**
 * AppLovinAnalytics — simplified analytics module for AppLovin Playable Ads.
 *
 * Sends events via window.ALPlayableAnalytics.trackEvent() per AppLovin spec:
 * @see https://support.axon.ai/en/growth/promoting-your-apps/creatives/playable-analytics-integration
 *
 * Fallback chain: window.ALPlayableAnalytics -> mraid -> console.log
 * game_start is deduplicated (sent only once).
 */

function trackEvent(eventName: string): void {
    try {
        // @ts-ignore
        if (typeof window !== 'undefined' && typeof window.ALPlayableAnalytics !== 'undefined') {
            // @ts-ignore
            window.ALPlayableAnalytics.trackEvent(eventName);
            console.log(`[AppLovin] ${eventName}`);
            return;
        }
    } catch (e) {}

    try {
        // @ts-ignore
        if (typeof mraid !== 'undefined' && typeof mraid.trackEvent === 'function') {
            // @ts-ignore
            mraid.trackEvent(eventName);
            console.log(`[AppLovin/mraid] ${eventName}`);
            return;
        }
    } catch (e) {}

    console.log(`[AppLovin/fallback] ${eventName}`);
}

const CHALLENGE_THROTTLE_MS = 50;

let _lastChallengeTime: number = 0;
let _challengeQueue: string[] = [];
let _challengeTimerId: ReturnType<typeof setTimeout> | null = null;

function _flushChallengeQueue(): void {
    if (_challengeQueue.length === 0) {
        _challengeTimerId = null;
        return;
    }

    const eventName = _challengeQueue.shift()!;
    _lastChallengeTime = Date.now();
    trackEvent(eventName);

    if (_challengeQueue.length > 0) {
        _challengeTimerId = setTimeout(_flushChallengeQueue, CHALLENGE_THROTTLE_MS);
    } else {
        _challengeTimerId = null;
    }
}

function enqueueChallengeEvent(eventName: string): void {
    const now = Date.now();
    const elapsed = now - _lastChallengeTime;

    if (_challengeQueue.length === 0 && elapsed >= CHALLENGE_THROTTLE_MS) {
        _lastChallengeTime = now;
        trackEvent(eventName);
    } else {
        _challengeQueue.push(eventName);
        if (_challengeTimerId === null) {
            const delay = Math.max(CHALLENGE_THROTTLE_MS - elapsed, CHALLENGE_THROTTLE_MS);
            _challengeTimerId = setTimeout(_flushChallengeQueue, delay);
        }
    }
}

let _gameStartSent = false;
let _pass25Sent = false;
let _pass50Sent = false;
let _pass75Sent = false;
let _winSent = false;
let _loseSent = false;

export const AppLovinAnalytics = {
    impression(): void {
        trackEvent('DISPLAYED');
    },

    gameStart(): void {
        if (_gameStartSent) return;
        _gameStartSent = true;
        enqueueChallengeEvent('CHALLENGE_STARTED');
    },

    challengePass25(): void {
        if (_pass25Sent) return;
        _pass25Sent = true;
        enqueueChallengeEvent('CHALLENGE_PASS_25');
    },

    challengePass50(): void {
        if (_pass50Sent) return;
        _pass50Sent = true;
        enqueueChallengeEvent('CHALLENGE_PASS_50');
    },

    challengePass75(): void {
        if (_pass75Sent) return;
        _pass75Sent = true;
        enqueueChallengeEvent('CHALLENGE_PASS_75');
    },

    win(): void {
        if (_winSent) return;
        _winSent = true;
        enqueueChallengeEvent('CHALLENGE_SOLVED');
    },

    lose(): void {
        if (_loseSent) return;
        _loseSent = true;
        enqueueChallengeEvent('COMPLETED');
    },

    ctaClick(): void {
        trackEvent('CTA_CLICKED');
    },
};
