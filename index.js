// index.js
const { PlaywrightCrawler, log } = require('crawlee');
const fs = require('fs');

const SCAN_URL = 'https://pump.fun/advanced/scan';
const LIMIT_PER_BATCH = parseInt(process.env.LIMIT || '30', 10);
const TARGET = parseInt(process.env.TARGET || '90', 10);
const REQUEST_HANDLER_TIMEOUT_SECS = parseInt(process.env.REQUEST_HANDLER_TIMEOUT_SECS || '300', 10);
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '3', 10);
const SCROLL_DELAY_MS = parseInt(process.env.SCROLL_DELAY_MS || '1000', 10);

(async () => {
    log.info('🔗 Starting parallelized PlaywrightCrawler to fetch tokens from Pump.fun');

    const collected = new Map(); // coinMint -> token object
    let offset = 0;
    let stop = false;

    const crawler = new PlaywrightCrawler({
        launchContext: { launchOptions: { headless: true } },
        maxConcurrency: MAX_CONCURRENCY,
        requestHandlerTimeoutSecs: REQUEST_HANDLER_TIMEOUT_SECS,
        async requestHandler({ page }) {

            // stop early if target reached
            if (stop) return;

            // Listen for XHR batches
            page.on('response', async (response) => {
                try {
                    const url = response.url();
                    if (!url.includes('list?sortBy=creationTime')) return;

                    let json;
                    try { json = await response.json(); } catch { return; }

                    const arr = Array.isArray(json) ? json : (json.data || json.coins || json.items || []);
                    if (!Array.isArray(arr) || arr.length === 0) return;

                    let newCount = 0;
                    for (const token of arr) {
                        const key = token.coinMint || token.mint || token.id || token.address;
                        if (!key) continue;
                        if (!collected.has(key)) {
                            collected.set(key, token);
                            newCount++;
                        }
                    }

                    if (newCount > 0) {
                        log.info(`✅ Captured batch: ${arr.length} tokens — new: ${newCount}, total: ${collected.size}`);
                        if (collected.size >= TARGET) stop = true;
                    }
                } catch (err) {
                    log.error('❌ Error processing response:', err.stack || err);
                }
            });

            // Navigate to batch URL
            const batchUrl = `${SCAN_URL}?limit=${LIMIT_PER_BATCH}&offset=${offset}`;
            offset += LIMIT_PER_BATCH;

            await page.goto(batchUrl, { waitUntil: 'networkidle', timeout: 0 });
            await page.waitForTimeout(SCROLL_DELAY_MS);

            // Save snapshot after each batch
            const arrCollected = Array.from(collected.values()).slice(0, TARGET);
            fs.writeFileSync('out.json', JSON.stringify(arrCollected, null, 2));
        },
    });

    // Prepare requests for first few batches
    const batchRequests = [];
    for (let i = 0; i < Math.ceil(TARGET / LIMIT_PER_BATCH) * 2; i++) { // extra batches to ensure coverage
        batchRequests.push({ url: SCAN_URL });
    }

    try { await crawler.run(batchRequests); } 
    catch (err) { log.error('❌ Crawler.run failed:', err.stack || err); }

    // Final save
    const final = Array.from(collected.values()).slice(0, TARGET);
    fs.writeFileSync('out.json', JSON.stringify(final, null, 2));
    log.info(`📁 Final saved ${final.length} tokens to out.json`);
    log.info('🚀 Done');
})();
