const refreshButton = document.querySelector('#refresh-button');
const refreshMessage = document.querySelector('#refresh-message');
const sourceCards = [...document.querySelectorAll('.source-card')];
const siteMenu = document.querySelector('#site-menu');
let initialRefreshAttempted = false;

siteMenu.addEventListener('click', (event) => {
    if (event.target.closest('a')) siteMenu.open = false;
});

function showCardMessage(grid, message, className = '') {
    const element = document.createElement('p');
    element.className = `card-message ${className}`.trim();
    element.textContent = message;
    grid.replaceChildren(element);
}

function renderSource(card, source) {
    const grid = card.querySelector('.reviews-grid');
    const status = card.querySelector('.source-status');
    grid.replaceChildren();
    status.textContent = '';

    for (const review of source.items || []) {
        const tile = document.createElement('a');
        tile.className = 'review-tile';
        tile.href = review.url;
        tile.target = '_blank';
        tile.rel = 'noopener noreferrer';
        tile.setAttribute('aria-label', `${review.title} — read review`);

        const image = document.createElement('img');
        image.className = 'review-artwork';
        image.src = review.image;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';

        const title = document.createElement('span');
        title.className = 'review-title';
        title.textContent = review.title;

        tile.append(image, title);
        grid.append(tile);
    }

    if (!source.items?.length) {
        if (source.loading) {
            showCardMessage(grid, 'Fetching reviews…', 'is-loading');
        } else if (source.error) {
            showCardMessage(grid, source.error, 'is-error');
        } else {
            showCardMessage(grid, 'No reviews are available right now.');
        }
    } else if (source.error) {
        status.textContent = `Could not refresh; showing the previous results. ${source.error}`;
        status.classList.add('is-error');
    } else if (source.updatedAt) {
        status.textContent = `Updated ${new Date(source.updatedAt).toLocaleString()}`;
        status.classList.remove('is-error');
    }
}

function renderSources(sources) {
    for (const source of sources) {
        const card = sourceCards.find((candidate) => candidate.dataset.source === source.id);
        if (card) renderSource(card, source);
    }
}

async function loadReviews() {
    try {
        const response = await fetch('/api/reviews', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load reviews (${response.status}).`);

        const data = await response.json();
        renderSources(data.sources);
        refreshButton.disabled = data.refreshing;
        refreshButton.textContent = data.refreshing ? 'Refreshing…' : 'Refresh reviews';

        if (data.refreshing) {
            window.setTimeout(loadReviews, 1500);
        } else if (!initialRefreshAttempted && data.sources.every((source) => !source.items?.length)) {
            initialRefreshAttempted = true;
            refreshButton.click();
        }
    } catch (error) {
        refreshMessage.textContent = error.message;
        for (const card of sourceCards) {
            showCardMessage(card.querySelector('.reviews-grid'), 'Review data could not be loaded.', 'is-error');
        }
    }
}

refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Refreshing…';
    refreshMessage.textContent = '';

    try {
        const response = await fetch('/api/refresh', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Refresh failed (${response.status}).`);
        refreshMessage.textContent = 'Checking the review sites for new posts…';
        await loadReviews();
    } catch (error) {
        refreshMessage.textContent = error.message;
        refreshButton.disabled = false;
        refreshButton.textContent = 'Refresh reviews';
        await loadReviews();
    }
});

loadReviews();
