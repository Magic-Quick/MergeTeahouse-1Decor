import { _decorator, Animation, Component, Node, tween, Tween, UITransform, Vec3 } from 'cc';
import { GlobalEventBus } from 'db://assets/scripts/common/event-bus';
import {
    EVT_CHEST_TAPPED,
    EVT_ITEM_DRAG_START,
    EVT_ITEM_PLACED,
    EVT_ITEM_SPAWNED,
} from 'db://assets/scripts/common/events';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const { ccclass, property } = _decorator;

interface ItemSpawnedEvent {
    type: string;
    item: DraggableItem;
    clone: Node;
}

interface ItemPlacedEvent {
    type: string;
    item: DraggableItem;
}

interface SpawnedHintTarget {
    item: DraggableItem;
    clone: Node;
}

/**
 * Two-step tutorial:
 * 1. Tap the box if the player waits too long at game start.
 * 2. Drag the first spawned item to its hologram if the player waits too long.
 */
@ccclass('ManualController')
export class ManualController extends Component {
    @property({ type: Node, tooltip: 'Нода руки с Animation-клипом HandTap' })
    uiHand: Node | null = null;

    @property({ type: Node, tooltip: 'Нода коробки, куда будет указывать первая подсказка' })
    boxNode: Node | null = null;

    @property({ tooltip: 'Задержка перед первой подсказкой на коробку, сек' })
    boxHintDelay: number = 3;

    @property({ tooltip: 'Повтор подсказки на коробку, сек' })
    boxHintRepeatDelay: number = 3;

    @property({ tooltip: 'Задержка перед подсказкой перетаскивания первого предмета, сек' })
    dragHintDelay: number = 3;

    @property({ tooltip: 'Повтор подсказки перетаскивания, сек' })
    dragHintRepeatDelay: number = 4;

    @property({ tooltip: 'Длительность движения руки от предмета к голограмме, сек' })
    dragHintMoveDuration: number = 0.8;

    @property({ tooltip: 'Если столько секунд не было установки предмета, показать подсказку к случайному вытащенному предмету' })
    placementIdleDelay: number = 5;

    @property({ tooltip: 'Повтор idle-подсказки установки, сек' })
    placementIdleRepeatDelay: number = 5;

    private _unsubs: Array<() => void> = [];
    private _boxStepDone: boolean = false;
    private _dragStepDone: boolean = false;
    private _firstItem: DraggableItem | null = null;
    private _firstClone: Node | null = null;
    private _spawnedHintTargets: SpawnedHintTarget[] = [];

    onLoad(): void {
        this._hideHand();
        this._unsubs.push(
            GlobalEventBus.subscribe(EVT_CHEST_TAPPED, () => this._onChestTapped()),
            GlobalEventBus.subscribe<ItemSpawnedEvent>(EVT_ITEM_SPAWNED, (event) => this._onItemSpawned(event)),
            GlobalEventBus.subscribe(EVT_ITEM_DRAG_START, () => this._onItemDragStart()),
            GlobalEventBus.subscribe<ItemPlacedEvent>(EVT_ITEM_PLACED, (event) => this._onItemPlaced(event)),
        );
    }

    start(): void {
        this._scheduleBoxHint(this.boxHintDelay);
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._stopHandTweens();
        for (const unsub of this._unsubs) unsub();
        this._unsubs.length = 0;
    }

    private _onChestTapped(): void {
        if (this._boxStepDone) return;
        this._boxStepDone = true;
        this.unschedule(this._showBoxHint);
        this._hideHand();
    }

    private _onItemSpawned(event: ItemSpawnedEvent): void {
        if (!event.item || !event.clone) return;

        this._spawnedHintTargets.push({ item: event.item, clone: event.clone });
        if (this._dragStepDone) {
            this._schedulePlacementIdleHint(this.placementIdleDelay);
        }

        if (this._dragStepDone || this._firstClone) return;

        this._firstItem = event.item;
        this._firstClone = event.clone;
        this._scheduleDragHint(this.dragHintDelay);
    }

    private _onItemDragStart(): void {
        if (this._dragStepDone) return;
        this._dragStepDone = true;
        this.unschedule(this._showDragHint);
        this._hideHand();
        this._schedulePlacementIdleHint(this.placementIdleDelay);
    }

    private _onItemPlaced(_event: ItemPlacedEvent): void {
        this._cleanupSpawnedHintTargets();
        this.unschedule(this._showPlacementIdleHint);
        this._hideHand();

        if (this._dragStepDone && this._getAvailablePlacementTargets().length > 0) {
            this._schedulePlacementIdleHint(this.placementIdleDelay);
        }
    }

    private _scheduleBoxHint(delay: number): void {
        if (this._boxStepDone) return;
        this.unschedule(this._showBoxHint);
        this.scheduleOnce(this._showBoxHint, delay);
    }

    private _showBoxHint(): void {
        if (this._boxStepDone || !this.uiHand || !this.boxNode || !this.boxNode.isValid) return;

        this._prepareHandAt(this.boxNode.worldPosition);
        this._playHandTap();
        this._scheduleBoxHint(this.boxHintRepeatDelay);
    }

    private _scheduleDragHint(delay: number): void {
        if (this._dragStepDone) return;
        this.unschedule(this._showDragHint);
        this.scheduleOnce(this._showDragHint, delay);
    }

    private _showDragHint(): void {
        if (this._dragStepDone || !this.uiHand || !this._firstClone || !this._firstItem) return;
        if (!this._firstClone.isValid || !this._firstClone.active || this._firstItem.isPlaced) return;

        const startPos = this._getVisualCenterWorld(this._firstClone);
        const targetPos = this._firstItem.targetWorldPos.clone();

        this._firstItem.playHologramHint();
        this._prepareHandAt(startPos);

        tween(this.uiHand)
            .delay(0.2)
            .to(this.dragHintMoveDuration, { worldPosition: targetPos }, { easing: 'quadInOut' })
            .call(() => {
                this._hideHand();
                this._scheduleDragHint(this.dragHintRepeatDelay);
            })
            .start();
    }

    private _schedulePlacementIdleHint(delay: number): void {
        if (!this._dragStepDone) return;
        this.unschedule(this._showPlacementIdleHint);
        this.scheduleOnce(this._showPlacementIdleHint, delay);
    }

    private _showPlacementIdleHint(): void {
        if (!this._dragStepDone || !this.uiHand) return;

        const target = this._pickRandomPlacementTarget();
        if (!target) return;

        this._playInstallPathHint(target.item, target.clone, () => {
            this._schedulePlacementIdleHint(this.placementIdleRepeatDelay);
        });
    }

    private _playInstallPathHint(item: DraggableItem, clone: Node, onComplete: () => void): void {
        if (!this.uiHand || !clone.isValid || !clone.active || item.isPlaced) return;

        const startPos = this._getVisualCenterWorld(clone);
        const targetPos = item.targetWorldPos.clone();

        item.playHologramHint();
        this._prepareHandAt(startPos);

        tween(this.uiHand)
            .delay(0.2)
            .to(this.dragHintMoveDuration, { worldPosition: targetPos }, { easing: 'quadInOut' })
            .call(() => {
                this._hideHand();
                onComplete();
            })
            .start();
    }

    private _playHandTap(): void {
        const anim = this.uiHand?.getComponent(Animation);
        if (!anim) return;
        anim.play('HandTap');
    }

    private _hideHand(): void {
        if (!this.uiHand) return;
        this._stopHandTweens();
        this.uiHand.active = false;
        this._resetHandAnimation();
    }

    private _stopHandTweens(): void {
        if (this.uiHand) {
            Tween.stopAllByTarget(this.uiHand);
        }
    }

    private _prepareHandAt(worldPos: Vec3): void {
        if (!this.uiHand) return;
        this._stopHandTweens();
        this.uiHand.active = false;
        this._resetHandAnimation();
        this.uiHand.setWorldPosition(worldPos);
        this.uiHand.active = true;
    }

    private _resetHandAnimation(): void {
        const anim = this.uiHand?.getComponent(Animation);
        if (!anim) return;

        anim.stop();
    }

    private _getVisualCenterWorld(node: Node): Vec3 {
        const spriteNode = node.getChildByName('Sprite') ?? node;
        const uiTransform = spriteNode.getComponent(UITransform) ?? node.getComponent(UITransform);
        if (!uiTransform) return spriteNode.worldPosition.clone();

        const rect = uiTransform.getBoundingBoxToWorld();
        return new Vec3(rect.x + rect.width * 0.5, rect.y + rect.height * 0.5, spriteNode.worldPosition.z);
    }

    private _pickRandomPlacementTarget(): SpawnedHintTarget | null {
        const available = this._getAvailablePlacementTargets();
        if (available.length === 0) return null;
        return available[Math.floor(Math.random() * available.length)];
    }

    private _getAvailablePlacementTargets(): SpawnedHintTarget[] {
        this._cleanupSpawnedHintTargets();
        return this._spawnedHintTargets;
    }

    private _cleanupSpawnedHintTargets(): void {
        this._spawnedHintTargets = this._spawnedHintTargets.filter(({ item, clone }) => {
            return !!item && !!clone && clone.isValid && clone.active && !item.isPlaced;
        });
    }
}
