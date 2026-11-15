const refreshButton = document.querySelector("#refresh-button");
const metricGrid = document.querySelector("#metric-grid");
const liveIndicator = document.querySelector("#live-indicator");
const connectionStatus = document.querySelector("#connection-status");
const lastUpdated = document.querySelector("#last-updated");
const nasaNote = document.querySelector("#nasa-note");
const eventsStatus = document.querySelector("#events-status");
const eventList = document.querySelector("#event-list");

let isLoading = false;

function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : "—";
}

function formatTime(value, includeDate = false) {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const options = includeDate
        ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
        : { hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat(undefined, options).format(date);
}

function setLoading(value) {
    isLoading = value;
    refreshButton.disabled = value;
    metricGrid.setAttribute("aria-busy", String(value));
}

function createEventCard(event) {
    const card = document.createElement("article");
    card.className = "event-card";

    const type = document.createElement("p");
    type.className = "event-type";
    type.textContent = event.type || "NASA NOTIFICATION";

    const title = document.createElement("h3");
    title.textContent = event.title || "Solar activity update";

    const time = document.createElement("time");
    time.className = "event-time";
    time.dateTime = event.time || "";
    time.textContent = formatTime(event.time, true) || "Time unavailable";

    card.append(type, title, time);

    if (event.summary) {
        const summary = document.createElement("p");
        summary.className = "event-summary";
        summary.textContent = event.summary;
        card.append(summary);
    }

    if (event.url) {
        const link = document.createElement("a");
        link.className = "event-link";
        link.href = event.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View NASA alert";
        card.append(link);
    }

    return card;
}

function renderEvents(events, errors = []) {
    eventList.replaceChildren();

    if (Array.isArray(events) && events.length > 0) {
        eventList.append(...events.map(createEventCard));
    }

    if (errors.length > 0) {
        eventsStatus.textContent = errors.join(" ");
        eventsStatus.classList.add("is-warning");
    } else if (eventList.childElementCount === 0) {
        eventsStatus.textContent = "No NASA DONKI notifications were reported in this period.";
        eventsStatus.classList.remove("is-warning");
    } else {
        eventsStatus.textContent = `${eventList.childElementCount} NASA notifications`;
        eventsStatus.classList.remove("is-warning");
    }
}

function renderDashboard(data) {
    const counts = data.counts || {};
    document.querySelector("#flare-count").textContent = formatNumber(counts.flares);
    document.querySelector("#cme-count").textContent = formatNumber(counts.cmes);
    document.querySelector("#storm-count").textContent = formatNumber(counts.storms);
    document.querySelector("#total-count").textContent = formatNumber(counts.total);

    const generatedAt = data.generatedAt || new Date().toISOString();
    lastUpdated.dateTime = generatedAt;
    lastUpdated.textContent = formatTime(generatedAt, true);

    connectionStatus.textContent = "NASA DONKI event feed updated";
    liveIndicator.dataset.state = "live";
    nasaNote.textContent = `Showing NASA notifications from ${data.windowStart} through ${data.windowEnd}.`;
    nasaNote.classList.remove("is-warning");

    renderEvents(data.events, data.errors);
}

async function refreshDashboard() {
    if (isLoading) {
        return;
    }

    setLoading(true);
    connectionStatus.textContent = "Updating NASA event data…";
    liveIndicator.dataset.state = "loading";

    try {
        const response = await fetch("/api/space-weather", {
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const details = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
            throw new Error(`${data.error || `NASA service returned HTTP ${response.status}.`}${details}`);
        }

        renderDashboard(data);
    } catch (error) {
        console.error("Unable to refresh NASA space-weather data.", error);
        connectionStatus.textContent = "NASA event data is temporarily unavailable.";
        liveIndicator.dataset.state = "error";
        nasaNote.textContent = error.message;
        nasaNote.classList.add("is-warning");
        eventsStatus.textContent = "NASA event data is unavailable.";
        eventsStatus.classList.add("is-warning");
    } finally {
        setLoading(false);
    }
}

refreshButton.addEventListener("click", refreshDashboard);
refreshDashboard();
window.setInterval(refreshDashboard, 5 * 60 * 1000);
