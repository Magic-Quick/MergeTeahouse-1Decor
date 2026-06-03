import { _decorator, Component, Node, view, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * В portrait сохраняет исходный localScale ноды.
 * В landscape выставляет uniform-scale из параметра landscapeScale.
 */
@ccclass('OrientationNodeScale')
export class OrientationNodeScale extends Component {
    @property({ type: Node, tooltip: 'Нода для масштабирования. Пусто — текущая нода компонента.' })
    targetNode: Node | null = null;

    @property({ tooltip: 'Uniform scale в горизонтальной (landscape) ориентации' })
    landscapeScale: number = 0.85;

    private _portraitScale: Vec3 = new Vec3(1, 1, 1);

    onLoad(): void {
        const node = this._getTarget();
        if (!node) return;

        this._portraitScale.set(node.scale);
        view.on('canvas-resize', this._applyScaleForOrientation, this);
        this._applyScaleForOrientation();
    }

    onDestroy(): void {
        view.off('canvas-resize', this._applyScaleForOrientation, this);
    }

    private _getTarget(): Node | null {
        const node = this.targetNode ?? this.node;
        return node?.isValid ? node : null;
    }

    private _applyScaleForOrientation = (): void => {
        const node = this._getTarget();
        if (!node) return;

        const { width, height } = view.getVisibleSize();
        const isLandscape = width > height;

        if (isLandscape) {
            const s = this.landscapeScale;
            node.setScale(s, s, this._portraitScale.z);
            return;
        }

        node.setScale(this._portraitScale);
    };
}
