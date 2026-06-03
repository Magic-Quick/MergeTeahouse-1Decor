import { _decorator } from 'cc';
import { DraggableItem } from 'db://assets/scripts/game/draggable-item';

const { ccclass, property } = _decorator;

/** Элемент массива itemSlots в DragDropController */
@ccclass('DraggableItemSlot')
export class DraggableItemSlot {
    @property({ type: DraggableItem, tooltip: 'Оригинал предмета в комнате' })
    item: DraggableItem | null = null;

    @property({
        tooltip: 'Множитель скейла клона при вылете из коробки. При установке плавно возвращается к исходному скейлу слота.',
    })
    spawnScale: number = 1;
}
