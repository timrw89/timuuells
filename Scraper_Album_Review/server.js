const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_REVIEWS = 8;
const PROJECT_DIR = __dirname;

const sourceDefinitions = [
    {
        id: 'angry-metal-guy',
        name: 'Angry Metal Guy',
        host: 'angrymetalguy.com',
        urls: [
            { url: 'https://www.angrymetalguy.com/category/reviews/', type: 'html' },
            { url: 'https://www.angrymetalguy.com/category/reviews/feed/', type: 'rss' }
        ],
        isReview: (title) => /\breview\b/i.test(title)
    },
    {
        id: 'metal-injection',
        name: 'Metal Injection',
        host: 'metalinjection.net',
        urls: [
            { url: 'https://metalinjection.net/category/reviews', type: 'html' },
            { url: 'https://metalinjection.net/category/reviews/feed', type: 'rss' }
        ],
        isReview: (title) => /\breviews?\b/i.test(title)
    },
    {
        id: 'metalreviews',
        name: 'MetalReviews',
        host: 'metalreviews.com',
        urls: [
            { url: 'https://metalreviews.com/reviews', type: 'html' }
        ]
    },
    {
        id: 'no-clean-singing',
        name: 'No Clean Singing',
        host: 'nocleansinging.com',
        urls: [
            { url: 'https://www.nocleansinging.com/category/reviews/album-reviews/', type: 'html' },
            { url: 'https://www.nocleansinging.com/category/reviews/album-reviews/feed/', type: 'rss' }
        ]
    }
];

const reviewState = sourceDefinitions.map((source) => ({
    id: source.id,
    name: source.name,
    items: [],
    updatedAt: null,
    loading: true,
    error: null
}));

let refreshPromise = null;
let lastRefreshAt = 0;

function text(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function resolveUrl(value, baseUrl, allowedHost) {
    if (!value) return null;

    try {
        const url = new URL(value, baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        if (allowedHost && url.hostname !== allowedHost && !url.hostname.endsWith(`.${allowedHost}`)) return null;
        return url.href;
    } catch {
        return null;
    }
}

function imageFromElement($, element) {
    const image = $(element);
    const srcset = image.attr('srcset') || image.attr('data-srcset');
    const largestSrc = srcset ? srcset.split(',').pop().trim().split(/\s+/)[0] : null;
    return image.attr('data-lazy-src')
        || image.attr('data-src')
        || image.attr('data-original')
        || largestSrc
        || image.attr('src')
        || null;
}

function makeReview(source, titleValue, imageValue, linkValue, baseUrl) {
    const title = text(titleValue);
    const url = resolveUrl(linkValue, baseUrl, source.host);
    const image = resolveUrl(imageValue, baseUrl);
    if (!title || !url || !image) return null;
    if (source.isReview && !source.isReview(title)) return null;
    return { title, image, url };
}

function parseHtml(source, html, pageUrl) {
    const $ = cheerio.load(html);
    const reviews = [];

    if (source.id === 'metalreviews') {
        $('a[href*="/reviews/album/"]').each((_, element) => {
            const anchor = $(element);
            const imageElement = anchor.find('img').first();
            const title = imageElement.attr('alt') || anchor.text();
            const review = makeReview(
                source,
                title,
                imageFromElement($, imageElement),
                anchor.attr('href'),
                pageUrl
            );
            if (review) reviews.push(review);
        });
    } else {
        $('article').each((_, element) => {
            const article = $(element);
            const titleElement = article.find(
                '.entry-title a, .zox-s-title2 a, h2 a, h3 a, .entry-title, .zox-s-title2, h2, h3'
            ).first();
            const imageElement = article.find('img').first();
            const imageAnchor = imageElement.closest('a');
            const review = makeReview(
                source,
                titleElement.text() || imageElement.attr('alt'),
                imageFromElement($, imageElement),
                titleElement.attr('href') || imageAnchor.attr('href') || article.find('a[href]').first().attr('href'),
                pageUrl
            );
            if (review) reviews.push(review);
        });
    }

    return uniqueReviews(reviews);
}

function parseRss(source, xml, feedUrl) {
    const $ = cheerio.load(xml, { xmlMode: true });
    const reviews = [];

    $('item').each((_, element) => {
        const item = $(element);
        const description = item.find('description').first().text();
        const descriptionDocument = cheerio.load(description);
        const firstImage = descriptionDocument('img').first();
        const imageField = item.children().toArray().find((child) =>
            child.tagName && child.tagName.toLowerCase().endsWith(':image_url')
        );
        const review = makeReview(
            source,
            item.find('title').first().text(),
            (imageField && $(imageField).text()) || imageFromElement(descriptionDocument, firstImage),
            item.find('link').first().text(),
            feedUrl
        );
        if (review) reviews.push(review);
    });

    return uniqueReviews(reviews);
}

function uniqueReviews(reviews) {
    const seen = new Set();
    return reviews.filter((review) => {
        if (seen.has(review.url)) return false;
        seen.add(review.url);
        return true;
    });
}

async function scrapeSource(source) {
    const collected = [];
    const failures = [];

    for (const endpoint of source.urls) {
        try {
            const response = await axios.get(endpoint.url, {
                timeout: 15000,
                headers: {
                    Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
                    'User-Agent': 'SquealAggregator/1.0'
                }
            });
            const found = endpoint.type === 'rss'
                ? parseRss(source, response.data, endpoint.url)
                : parseHtml(source, response.data, endpoint.url);
            collected.push(...found);
            if (uniqueReviews(collected).length >= MAX_REVIEWS) break;
        } catch (error) {
            const status = error.response ? `HTTP ${error.response.status}` : error.code || error.message;
            failures.push(`${endpoint.url}: ${status}`);
        }
    }

    const results = uniqueReviews(collected).slice(0, MAX_REVIEWS);
    if (!results.length) {
        const reason = failures.length ? failures.join('; ') : 'No matching review entries were found.';
        throw new Error(reason);
    }
    return results;
}

function refreshReviews() {
    if (refreshPromise) return refreshPromise;

    lastRefreshAt = Date.now();
    for (const source of reviewState) {
        source.loading = true;
        source.error = null;
    }

    refreshPromise = Promise.all(sourceDefinitions.map(async (definition) => {
        const state = reviewState.find((source) => source.id === definition.id);
        try {
            state.items = await scrapeSource(definition);
            state.updatedAt = new Date().toISOString();
        } catch (error) {
            state.error = error.message;
            console.error(`${definition.name}: ${error.message}`);
        } finally {
            state.loading = false;
        }
    })).finally(() => {
        refreshPromise = null;
    });

    return refreshPromise;
}

app.get('/', (request, response) => {
    response.sendFile(path.join(PROJECT_DIR, 'index.html'));
});

app.get('/styles.css', (request, response) => {
    response.sendFile(path.join(PROJECT_DIR, 'styles.css'));
});

app.get('/app.js', (request, response) => {
    response.sendFile(path.join(PROJECT_DIR, 'app.js'));
});

app.get('/api/reviews', (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ refreshing: Boolean(refreshPromise), sources: reviewState });
});

app.post('/api/refresh', async (request, response) => {
    if (refreshPromise) {
        response.status(202).json({ refreshing: true, sources: reviewState });
        return;
    }

    const waitMs = REFRESH_COOLDOWN_MS - (Date.now() - lastRefreshAt);
    if (waitMs > 0) {
        response.status(429).json({
            error: `Please wait ${Math.ceil(waitMs / 1000)} seconds before refreshing again.`
        });
        return;
    }

    const update = refreshReviews();
    response.status(202).json({ refreshing: true, sources: reviewState });
    await update;
});

app.listen(PORT, () => {
    console.log(`Squeal is running at http://localhost:${PORT}`);
    refreshReviews();
});
