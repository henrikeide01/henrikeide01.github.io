// Runs the hero recognition (src/vision/detect.js) in a worker thread, so the overlay never stutters.
// Messages: { id, type: 'templates', heroes: [{ name, image }] } and { id, type: 'detect', screen, opts }.
import { parentPort } from 'node:worker_threads';
import { prepareTemplates, detectTopBar, learnLayout } from '../src/vision/detect.js';

let templates = null;

const asImage = (img) => ({ width: img.width, height: img.height, format: img.format, data: new Uint8Array(img.data) });

parentPort.on('message', (msg) => {
  try {
    if (msg.type === 'templates') {
      templates = prepareTemplates(msg.heroes.map((h) => ({ name: h.name, image: asImage(h.image) })));
      parentPort.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'detect') {
      if (!templates) throw new Error('Heltebildene er ikke lastet ennå');
      const result = detectTopBar(asImage(msg.screen), templates, msg.opts || {});
      // A full search that sees (almost) every portrait tells us where the 10 slots are on this screen.
      const layout = result.searched === 'full' ? learnLayout(result) : null;
      parentPort.postMessage({ id: msg.id, ok: true, result, layout });
    }
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: err.message });
  }
});
