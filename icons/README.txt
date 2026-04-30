Replace with real icons; placeholders pending.
Chrome will use a generic icon if missing — extension will still load.

Required files:
  icon16.png   — 16x16 px
  icon48.png   — 48x48 px
  icon128.png  — 128x128 px

Any simple colored square PNG works for personal use.
You can generate them quickly with ImageMagick:
  convert -size 16x16 xc:#2563eb icon16.png
  convert -size 48x48 xc:#2563eb icon48.png
  convert -size 128x128 xc:#2563eb icon128.png
