# Merge Teahouse: Decor

> **Важно:** Общайся с пользователем на русском языке.

## Project Overview

A casual mobile game where the player extracts items from a container and places them in a house.

## Game Flow

1. **Start:** Empty isometric room with an open golden chest at the bottom of the screen.
2. **Action:** Player taps the chest, from which the first item (carved chair) flies out.
3. **Hint:** Blue holographic silhouettes appear in the room, indicating correct placement spots.
4. **Mechanic:** Player drags the chair to the corresponding silhouette; the item locks in place with a "flash" effect.
5. **Progression:** Items are sequentially extracted from the chest: window, wall painting, pink sofa.
6. **Logic:** Player must match the item type with the zone (windows and paintings — on walls, furniture — on floor).
7. **Feedback:** Each exact hit into a slot is accompanied by a "ding" sound and coins flying to the counter.
8. **Completion:** When the last item (tea table) takes its place, the room is considered ready.
9. **Result:** The scene is flooded with bright light, the inscription "PERFECT DESIGN!" and festive confetti appear.
10. **CTA:** Final packshot "DECORATE YOUR HOME" with a button to the store "PLAY NOW".

## Project Structure

```
assets/
 ├── art/
 │    ├── bg/          # Фоны и задники
 │    ├── room/        # Элементы изометрической комнаты
 │    ├── furniture/   # Спрайты предметов мебели
 │    ├── ui/          # UI-элементы (кнопки, панели, иконки)
 │    ├── fx/          # Эффекты (вспышка, конфетти, монеты)
 │    └── ghost/       # Голографические силуэты-подсказки
 │
 ├── audio/            # Звуковые эффекты и музыка
 │
 ├── prefabs/          # Prefab-объекты (предметы, слоты, UI)
 │
 ├── scenes/           # Сцены Cocos Creator
 │
 ├── scripts/          # TypeScript-скрипты
 │
 └── animations/       # Анимации (clip-файлы)

settings/             # Настройки проекта Cocos Creator
```

## Engine

- **Cocos Creator** (TypeScript)

## Development Notes

- Isometric room view
- Drag-and-drop placement mechanic
- Holographic silhouette hints
- Sound effects: "ding" on successful placement
- Particle effects: flash on item placement, confetti on completion
- UI: coin counter, CTA screen
