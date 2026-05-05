// Канонические имена событий. Импортируй и используй вместо строк напрямую.

// ─── Ввод ────────────────────────────────────────────────────────────────────
export const EVT_TAP          = 'Tap';          // { x, y }
export const EVT_DRAG_START   = 'DragStart';    // { x, y, target }
export const EVT_DRAG_MOVE    = 'DragMove';     // { x, y }
export const EVT_DRAG_END     = 'DragEnd';      // { x, y }
export const EVT_DRAG_CANCEL  = 'DragCancel';   // {}

// ─── Шкатулка ────────────────────────────────────────────────────────────────
export const EVT_CHEST_TAPPED        = 'ChestTapped';        // {}
export const EVT_ITEM_SPAWNED        = 'ItemSpawned';        // { item: FurnitureItem }
export const EVT_ALL_ITEMS_SPAWNED   = 'AllItemsSpawned';    // {}

// ─── Предметы / перетаскивание ───────────────────────────────────────────────
export const EVT_ITEM_DRAG_START     = 'ItemDragStart';      // { item }
export const EVT_ITEM_DRAG_END       = 'ItemDragEnd';        // { item }
export const EVT_ITEM_DROP_ATTEMPT   = 'ItemDropAttempt';    // { item, slotId }
export const EVT_ITEM_PLACED         = 'ItemPlaced';         // { item, slotId }
export const EVT_ITEM_WRONG_SLOT     = 'ItemWrongSlot';      // { item, slotId }

// ─── Слоты ───────────────────────────────────────────────────────────────────
export const EVT_SLOT_ACTIVATED      = 'SlotActivated';      // { slotId }
export const EVT_SLOT_FILLED         = 'SlotFilled';         // { slotId }

// ─── Счёт / монеты ───────────────────────────────────────────────────────────
export const EVT_SCORE_CHANGED       = 'ScoreChanged';       // { delta, total }
export const EVT_COINS_FLIGHT        = 'CoinsFlightStarted'; // { amount, fromPos }

// ─── Игровой цикл ────────────────────────────────────────────────────────────
export const EVT_GAME_STARTED        = 'GameStarted';        // {}
export const EVT_GAME_COMPLETE       = 'GameComplete';       // {}
export const EVT_ROOM_READY          = 'RoomReady';          // {}

// ─── UI / CTA ────────────────────────────────────────────────────────────────
export const EVT_CTA_SHOWN           = 'CTAShown';           // {}
export const EVT_STORE_BUTTON_TAPPED = 'StoreButtonTapped';  // {}

// ─── Аудио ───────────────────────────────────────────────────────────────────
export const EVT_PLAY_SOUND          = 'PlaySound';          // { soundId: string }

// Sound IDs
export const SOUND_CHEST_TAP         = 'chest_tap';
export const SOUND_ITEM_SPAWN        = 'item_spawn';
export const SOUND_ITEM_PLACED       = 'item_placed';   // «дзинь»
export const SOUND_WRONG_SLOT        = 'wrong_slot';
export const SOUND_ROOM_COMPLETE     = 'room_complete';
export const SOUND_COINS             = 'coins';
export const SOUND_CONFETTI          = 'confetti';
