/** Dev helper: probe YouTube iframe embeddability for video IDs. */
const { checkYoutubeEmbeddable } = require('../server/services/youtube');

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/check-embed.js VIDEO_ID ...');
  process.exit(1);
}

(async () => {
  for (const id of ids) {
    try {
      const r = await checkYoutubeEmbeddable(id);
      console.log(r.embeddable ? 'OK  ' : 'FAIL', JSON.stringify(r));
    } catch (e) {
      console.log('ERR ', id, e.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
})();
