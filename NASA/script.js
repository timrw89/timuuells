const refreshButton = document.querySelector("#refresh-button");
const animationToggle = document.querySelector("#animation-toggle");
const metricGrid = document.querySelector("#metric-grid");
const liveIndicator = document.querySelector("#live-indicator");
const connectionStatus = document.querySelector("#connection-status");
const lastUpdated = document.querySelector("#last-updated");
const nasaNote = document.querySelector("#nasa-note");
const animationStatus = document.querySelector("#animation-status");
const animationCaption = document.querySelector("#animation-caption");
const animationFrameTime = document.querySelector("#animation-frame-time");
const latestAlertLink = document.querySelector("#latest-alert-link");
const solarFrame = document.querySelector("#solar-frame");

let isLoading = false;
let isLoadingAnimation = false;
let animationAlertTime = "";
let animationRequestId = 0;
let animationFrames = [];
let animationFrameIndex = 0;
let animationInterval = null;

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

function stopAnimation() {
    if (animationInterval !== null) {
        window.clearInterval(animationInterval);
        animationInterval = null;
    }
}

function resetAnimation() {
    stopAnimation();
    animationFrames = [];
    animationFrameIndex = 0;
    animationToggle.disabled = true;
    animationToggle.textContent = "Play animation";
    solarFrame.hidden = true;
    solarFrame.removeAttribute("src");
    solarFrame.alt = "";
    animationFrameTime.textContent = "Waiting for solar images…";
}

function showFrame(index) {
    const frame = animationFrames[index];
    if (!frame) {
        return;
    }

    animationFrameIndex = index;
    solarFrame.src = frame.url;
    solarFrame.alt = `SDO/AIA ${frame.channel} Å solar image at ${formatTime(frame.time, true)}`;
    solarFrame.hidden = false;
    animationFrameTime.dateTime = frame.time;
    animationFrameTime.textContent =
        `Frame ${index + 1} of ${animationFrames.length} · ` +
        `${formatTime(frame.time, true)} · SDO/AIA ${frame.channel} Å`;
}

function playAnimation() {
    if (animationFrames.length === 0) {
        return;
    }

    stopAnimation();
    animationToggle.textContent = "Pause animation";
    animationInterval = window.setInterval(() => {
        showFrame((animationFrameIndex + 1) % animationFrames.length);
    }, 750);
}

function preloadFrame(frame) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(frame);
        image.onerror = () => resolve(null);
        image.src = frame.url;
    });
}

function showAnimationError(error, requestId) {
    if (requestId !== animationRequestId) {
        return;
    }

    console.error("Unable to load Helioviewer images.", error);
    animationStatus.textContent = error.message;
    animationStatus.classList.add("is-warning");
    isLoadingAnimation = false;
    animationAlertTime = "";
    resetAnimation();
}

async function loadSolarAnimation(alert) {
    if (!alert || !alert.time || !alert.code) {
        animationRequestId += 1;
        isLoadingAnimation = false;
        animationAlertTime = "";
        resetAnimation();
        animationStatus.textContent = "No NASA alert is available to build a recent time-lapse.";
        animationStatus.classList.remove("is-warning");
        animationCaption.textContent = "NASA DONKI has not reported an alert in the current 7-day window.";
        latestAlertLink.hidden = true;
        return;
    }

    if (
        animationAlertTime === alert.time &&
        (isLoadingAnimation || animationFrames.length > 0)
    ) {
        return;
    }

    animationAlertTime = alert.time;
    isLoadingAnimation = true;
    const requestId = ++animationRequestId;
    const alertTime = formatTime(alert.time, true);

    resetAnimation();
    animationStatus.classList.remove("is-warning");
    animationStatus.textContent = `Preparing solar images around the NASA alert from ${alertTime}…`;
    animationCaption.textContent =
        `${alert.title || alert.type} · NASA alert issued ${alertTime}. ` +
        "The animation shows 24 hourly images ending at that timestamp.";

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
        const data = await readResponse(response);
        if (requestId !== animationRequestId) {
            return;
        }
        if (!Array.isArray(data.frames) || data.frames.length === 0) {
            throw new Error("Helioviewer did not provide any solar images.");
        }

        const loadedFrames = [];
        for (let offset = 0; offset < data.frames.length; offset += 3) {
            if (requestId !== animationRequestId) {
                return;
            }

            const batch = data.frames.slice(offset, offset + 3);
            animationStatus.textContent =
                `Loading solar images ${Math.min(offset + batch.length, data.frames.length)} ` +
                `of ${data.frames.length}…`;
            const results = await Promise.all(batch.map(preloadFrame));
            loadedFrames.push(...results.filter(Boolean));
        }

        if (requestId !== animationRequestId) {
            return;
        }
        if (loadedFrames.length === 0) {
            throw new Error("No SDO/AIA images were available for this NASA alert.");
        }

        animationFrames = loadedFrames.map((frame) => ({
            ...frame,
            channel: data.channel
        }));
        showFrame(0);
        animationToggle.disabled = false;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const availability = loadedFrames.length === data.frames.length
            ? `${loadedFrames.length} solar images loaded.`
            : `${loadedFrames.length} of ${data.frames.length} solar images were available.`;

        if (reducedMotion) {
            animationToggle.textContent = "Play animation";
            animationStatus.textContent = `${availability} Press play to start the time-lapse.`;
        } else {
            playAnimation();
            animationStatus.textContent = `${availability} Playing the 24-hour time-lapse.`;
        }
    } catch (error) {
        showAnimationError(error, requestId);
    } finally {
        if (requestId === animationRequestId) {
            isLoadingAnimation = false;
        }
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

animationToggle.addEventListener("click", () => {
    if (animationInterval === null) {
        playAnimation();
        animationStatus.textContent = "Playing the solar time-lapse.";
    } else {
        stopAnimation();
        animationToggle.textContent = "Play animation";
        animationStatus.textContent = "Solar time-lapse paused.";
    }
});

refreshButton.addEventListener("click", refreshDashboard);
refreshDashboard();
window.setInterval(refreshDashboard, 5 * 60 * 1000);
