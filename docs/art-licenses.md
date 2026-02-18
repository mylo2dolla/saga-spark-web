# Mythic 16-bit Art License Manifest

This project uses reference-inspired pixel art direction and only allows original or permissively licensed assets.

## Approved Packs and Terms

1. Kenney "Tiny Dungeon" (CC0)
- URL: https://kenney.nl/assets/tiny-dungeon
- License: CC0 1.0
- Intended use: dungeon floors, walls, props.

2. Kenney "Topdown Pack" (CC0)
- URL: https://kenney.nl/assets/topdown-pack
- License: CC0 1.0
- Intended use: travel terrain tiles and world objects.

3. Ansimuz "Sunny Land Pixel Game Art" (CC0-friendly free license for use)
- URL: https://ansimuz.itch.io/sunny-land-pixel-game-art
- License: Free-to-use license on asset page.
- Intended use: town decorations and ambient sprites.

4. CraftPix Free RPG Icons (free license with attribution requirements per pack)
- URL: https://craftpix.net/freebies/
- License: Pack-specific free license.
- Intended use: UI action/loot/status iconography.

## Compliance Rules

- No direct sprite extraction from Secret of Mana, Zelda, Diablo, FFT, Fire Emblem, or Final Fantasy titles.
- Visual references are style direction only.
- Any non-CC0 pack must include the pack name and source URL in this document before merge.

## Integrity / Checksums

Run this when asset files are imported:

```bash
find public/game -type f -print0 | xargs -0 shasum -a 256
```

Record output snapshots below during release prep.
