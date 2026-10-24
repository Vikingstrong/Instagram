// Rebuilds the live gift pictures in apps/web/public/gifts from art/:
// the SVG artwork becomes 512×512 PNG, and the CC0 pixel cat GIF gets a
// transparent background in every frame. Run: node scripts/gifts/render.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
const art = (name) => fileURLToPath(new URL(`art/${name}`, import.meta.url));
const out = (name) =>
  fileURLToPath(new URL(`../../apps/web/public/gifts/${name}`, import.meta.url));

for (const name of ['rose', 'heart', 'glasses', 'instagram', 'pumpkin'])
  await sharp(art(`${name}.svg`), { density: 288 })
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(out(`${name}.png`));

const cat = sharp(art('cat_run.gif'), { animated: true });
const meta = await cat.metadata();
const { data, info } = await cat.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
// The solid background is the colour of the first pixel.
const [r, g, b] = data;
for (let i = 0; i < data.length; i += 4)
  if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 24)
    data[i + 3] = 0;
await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4, pageHeight: meta.pageHeight },
  animated: true,
})
  .gif({ delay: meta.delay, loop: 0 })
  .toFile(out('cat.gif'));
