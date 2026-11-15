const refreshButton = document.querySelector("#refresh-button");
const metricGrid = document.querySelector("#metric-grid");
const liveIndicator = document.querySelector("#live-indicator");
const connectionStatus = document.querySelector("#connection-status");
const lastUpdated = document.querySelector("#last-updated");
const nasaNote = document.querySelector("#nasa-note");
const animationStatus = document.querySelector("#animation-status");
const animationCaption = document.querySelector("#animation-caption");
const latestAlertLink = document.querySelector("#latest-alert-link");
const solarVideo = document.querySelector("#solar-video");

let isLoading = false;
let animationAlertTime = "";
let animationRequestId = 0;
let animationPending = false;

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

async function readResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const details = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
        throw new Error(`${data.error || `Service returned HTTP ${response.status}.`}${details}`);
    }

    return data;
}

function showAnimationError(error, requestId) {
    if (requestId !== animationRequestId) {
        return;
    }

    console.error("Unable to create the Helioviewer animation.", error);
    animationStatus.textContent = error.message;
    animationStatus.classList.add("is-warning");
    animationPending = false;
    animationAlertTime = "";
}

async function pollSolarAnimation(job, requestId, attempt = 0) {
    if (requestId !== animationRequestId) {
        return;
    }
    if (attempt >= 40) {
        throw new Error("Helioviewer is taking longer than expected. Refresh to try again.");
    }

    const response = await fetch("/api/solar-motion", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: job.id, token: job.token })
    });
    const result = await readResponse(response);

    if (response.status === 202) {
        animationStatus.textContent = `Helioviewer is rendering the solar time-lapse (${result.status}).`;
        window.setTimeout(() => {
            pollSolarAnimation(job, requestId, attempt + 1)
                .catch((error) => showAnimationError(error, requestId));
        }, 15000);
        return;
    }

    if (requestId !== animationRequestId) {
        return;
    }

    solarVideo.poster = result.posterUrl;
    solarVideo.src = result.videoUrl;
    solarVideo.hidden = false;
    solarVideo.load();
    animationStatus.textContent = `Animation ready: ${result.title}.`;
    animationStatus.classList.remove("is-warning");
    animationPending = false;

    solarVideo.play().catch(() => {
        animationStatus.textContent = `Animation ready: ${result.title}. Press play to start.`;
    });
}

async function loadSolarAnimation(alert) {
    if (!alert || !alert.time || !alert.code) {
        animationRequestId += 1;
        animationPending = false;
        animationAlertTime = "";
        solarVideo.pause();
        solarVideo.removeAttribute("src");
        solarVideo.removeAttribute("poster");
        solarVideo.hidden = true;
        solarVideo.load();
        animationStatus.textContent = "No NASA alert is available to build a recent time-lapse.";
        animationStatus.classList.remove("is-warning");
        animationCaption.textContent = "NASA DONKI has not reported an alert in the current 7-day window.";
        latestAlertLink.hidden = true;
        return;
    }

    if (animationAlertTime === alert.time && (animationPending || !solarVideo.hidden)) {
        return;
    }

    animationAlertTime = alert.time;
    animationPending = true;
    const requestId = ++animationRequestId;
    const alertTime = formatTime(alert.time, true);

    solarVideo.pause();
    solarVideo.removeAttribute("src");
    solarVideo.removeAttribute("poster");
    solarVideo.hidden = true;
    solarVideo.load();
    animationStatus.classList.remove("is-warning");
    animationStatus.textContent = `Preparing a time-lapse around the NASA alert from ${alertTime}…`;
    animationCaption.textContent = `${alert.title || alert.type} · NASA alert issued ${alertTime}. The animation covers the 24 hours before that timestamp.`;

    if (alert.url) {
        latestAlertLink.href = alert.url;
        latestAlertLink.hidden = false;
    } else {
        latestAlertLink.hidden = true;
    }

    try {
        const response = await fetch("/api/solar-motion", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ time: alert.time, type: alert.code })
        });
        const job = await readResponse(response);
        if (response.status !== 202) {
            throw new Error("Helioviewer did not start the animation job.");
        }

        const estimate = job.eta ? ` Estimated wait: about ${Math.ceil(job.eta / 60)} min.` : "";
        animationStatus.textContent = `Helioviewer queued the SDO/AIA ${job.channel} Å time-lapse.${estimate}`;
        await pollSolarAnimation(job, requestId);
    } catch (error) {
        showAnimationError(error, requestId);
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

    void loadSolarAnimation(data.latestAlert);
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
        renderDashboard(await readResponse(response));
    } catch (error) {
        console.error("Unable to refresh NASA space-weather data.", error);
        connectionStatus.textContent = "NASA event data is temporarily unavailable.";
        liveIndicator.dataset.state = "error";
        nasaNote.textContent = error.message;
        nasaNote.classList.add("is-warning");
        animationStatus.textContent = "NASA event data is unavailable.";
        animationStatus.classList.add("is-warning");
    } finally {
        setLoading(false);
    }
}

refreshButton.addEventListener("click", refreshDashboard);
refreshDashboard();
window.setInterval(refreshDashboard, 5 * 60 * 1000);
