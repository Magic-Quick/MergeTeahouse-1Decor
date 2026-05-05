// EventBus — шина событий для слабосвязанного взаимодействия между системами.

export interface EventBase {
    type: string;
}

export type EventHandler<T extends EventBase = EventBase> = (event: T) => void;

export interface IEventBus {
    publish<T extends EventBase>(event: T): void;
    subscribe<T extends EventBase>(type: string, handler: EventHandler<T>): () => void;
    clearAll(): void;
}

export class EventBus implements IEventBus {
    private readonly typeToHandlers: Map<string, Set<EventHandler>> = new Map();

    publish<T extends EventBase>(event: T): void {
        if (!event || typeof event.type !== 'string' || event.type.length === 0) return;

        const handlers = this.typeToHandlers.get(event.type);
        if (!handlers || handlers.size === 0) return;

        const snapshot = Array.from(handlers);
        for (const handler of snapshot) {
            try {
                (handler as EventHandler<T>)(event);
            } catch (error) {
                console.error(`[EventBus] Handler error for type="${event.type}":`, error);
            }
        }
    }

    subscribe<T extends EventBase>(type: string, handler: EventHandler<T>): () => void {
        if (typeof type !== 'string' || type.length === 0) {
            throw new Error("EventBus.subscribe: 'type' must be a non-empty string");
        }
        if (typeof handler !== 'function') {
            throw new Error("EventBus.subscribe: 'handler' must be a function");
        }

        let set = this.typeToHandlers.get(type);
        if (!set) {
            set = new Set<EventHandler>();
            this.typeToHandlers.set(type, set);
        }
        set.add(handler as EventHandler);

        let unsubscribed = false;
        return () => {
            if (unsubscribed) return;
            unsubscribed = true;
            const current = this.typeToHandlers.get(type);
            if (!current) return;
            current.delete(handler as EventHandler);
            if (current.size === 0) this.typeToHandlers.delete(type);
        };
    }

    clearAll(): void {
        this.typeToHandlers.clear();
    }
}

export const GlobalEventBus: IEventBus = new EventBus();
