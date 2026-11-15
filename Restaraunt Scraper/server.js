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
        id: 'ri-monthly',
        name: 'Rhode Island Monthly',
        host: 'rimonthly.com',
        urls: [
            { url: 'https://www.rimonthly.com/category/food-and-drink/review/feed/', type: 'rss' },
            { url: 'https://www.rimonthly.com/food-drink/restaurant-reviews/', type: 'html' }
        ],
    },
    {
        id: 'fork-in-the-rhode',
        name: 'Fork in the Rhode',
        host: 'forkintherhode.com',
        urls: [
            { url: 'https://forkintherhode.com/category/rhode-island-restaurant-reviews/feed/', type: 'rss' },
            { url: 'https://forkintherhode.com/category/rhode-island-restaurant-reviews/', type: 'html' }
        ],
    },
    {
        id: 'opentable',
        name: 'OpenTable',
        host: 'opentable.com',
        urls: [
            { url: 'https://www.opentable.com/metro/us/rhode-island-restaurants', type: 'html' }
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
    const largestSrc = srcset
        ? srcset.split(',')
            .map((candidate) => {
                const [url, size] = candidate.trim().split(/\s+/);
                return { url, width: Number.parseInt(size, 10) || 0 };
            })
            .sort((left, right) => right.width - left.width)[0]?.url
        : null;
    return image.attr('data-lazy-src')
        || image.attr('data-src')
        || image.attr('data-original')
        || image.attr('data-orig-file')
        || image.attr('data-large-file')
        || largestSrc
        || image.attr('src')
        || null;
}

function makeReview(source, titleValue, imageValue, linkValue, baseUrl) {
    const title = text(titleValue);
    const url = resolveUrl(linkValue, baseUrl, source.host);
    const image = resolveUrl(imageValue, baseUrl);
    if (!title || !url || !image) return null;
    return { title, image, url };
}

function parseHtml(source, html, pageUrl) {
    const $ = cheerio.load(html);
    const reviews = [];

    const cards = source.id === 'opentable'
        ? $('article, [data-testid*="restaurant"], [class*="restaurant-card"]')
        : $('article');

    cards.each((_, element) => {
        const card = $(element);
        const titleElement = card.find(
            '.entry-title a, h2 a, h3 a, h4 a, [data-testid*="restaurant-name"]'
        ).first();
        const imageElement = card.find('img').first();
        const imageAnchor = imageElement.closest('a');
        const review = makeReview(
            source,
            titleElement.text() || titleElement.attr('aria-label') || imageElement.attr('alt'),
            imageFromElement($, imageElement),
            titleElement.attr('href') || imageAnchor.attr('href') || card.find('a[href]').first().attr('href'),
            pageUrl
        );
        if (review) reviews.push(review);
    });

    if (source.id === 'opentable' && !reviews.length) {
        $('a[href]').each((_, element) => {
            const anchor = $(element);
            const imageElement = anchor.find('img').first();
            if (!imageElement.length) return;

            const review = makeReview(
                source,
                anchor.text() || imageElement.attr('alt'),
                imageFromElement($, imageElement),
                anchor.attr('href'),
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
        const encodedContent = item.children().toArray().find((child) =>
            child.tagName && child.tagName.toLowerCase().endsWith(':encoded')
        );
        const content = encodedContent ? $(encodedContent).text() : description;
        const contentDocument = cheerio.load(content);
        const firstImage = contentDocument('img').first();
        const imageField = item.children().toArray().find((child) =>
            child.tagName && child.tagName.toLowerCase().endsWith(':image_url')
        );
        const review = makeReview(
            source,
            item.find('title').first().text(),
            (imageField && $(imageField).text()) || imageFromElement(contentDocument, firstImage),
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
                    'User-Agent': 'RhodyScoopAggregator/1.0'
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
    console.log(`Rhody Scoop is running at http://localhost:${PORT}`);
    refreshReviews();
});
