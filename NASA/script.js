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
const epicRefresh = document.querySelector("#epic-refresh");
const epicStatus = document.querySelector("#epic-status");
const epicGallery = document.querySelector("#epic-gallery");
const epicImage = document.querySelector("#epic-image");
const epicCaption = document.querySelector("#epic-caption");
const epicPrev = document.querySelector("#epic-prev");
const epicNext = document.querySelector("#epic-next");
const epicPlay = document.querySelector("#epic-play");
const satelliteCanvas = document.querySelector("#satellite-canvas");
const satelliteStatus = document.querySelector("#satellite-status");
const satelliteCount = document.querySelector("#satellite-count");
const satelliteRefresh = document.querySelector("#satellite-refresh");
const earthTexture = new Image();

let isLoading = false;
let isLoadingAnimation = false;
let isLoadingEpic = false;
let isLoadingSatellites = false;
let animationAlertTime = "";
let animationRequestId = 0;
let animationFrames = [];
let animationFrameIndex = 0;
let animationInterval = null;
let satelliteElements = [];
let epicImages = [];
let epicIndex = 0;
let epicInterval = null;

const EARTH_RADIUS_KM = 6371;
const EARTH_MU_KM3_PER_S2 = 398600.4418;
const ORBIT_COLORS = {
    low: "#7ce8ff",
    medium: "#c6f36b",
    high: "#ffb27b"
};

earthTexture.addEventListener("load", () => {
    drawSatelliteScene();
});
earthTexture.src = "./earth.svg";

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
    if (lastUpdated) {
        lastUpdated.dateTime = generatedAt;
        lastUpdated.textContent = formatTime(generatedAt, true);
    }

    connectionStatus.textContent = "NASA DONKI event feed updated";
    liveIndicator.dataset.state = "live";
    nasaNote.textContent = `Showing NASA notifications from ${data.windowStart} through ${data.windowEnd}.`;
    nasaNote.classList.remove("is-warning");

    void loadSolarAnimation(data.latestAlert);
}

function drawEarth(context, centerX, centerY, radius) {
    context.save();
    context.shadowColor = "rgba(83, 197, 255, .38)";
    context.shadowBlur = 22;
    context.fillStyle = "#0b3158";
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.clip();
    if (earthTexture.complete && earthTexture.naturalWidth > 0) {
        context.drawImage(
            earthTexture,
            centerX - radius,
            centerY - radius,
            radius * 2,
            radius * 2
        );
    }
    context.restore();
}

function getSatellitePosition(satellite, now) {
    const epoch = Date.parse(satellite.epoch);
    const meanMotion = satellite.meanMotion * (2 * Math.PI) / 86400;
    const semiMajorAxis = Math.cbrt(EARTH_MU_KM3_PER_S2 / (meanMotion * meanMotion));
    const elapsedSeconds = (now - epoch) / 1000;
    const meanAnomalyValue =
        satellite.meanAnomaly * Math.PI / 180 + meanMotion * elapsedSeconds;
    const meanAnomaly = (
        (meanAnomalyValue % (2 * Math.PI)) + 2 * Math.PI
    ) % (2 * Math.PI);
    const eccentricity = satellite.eccentricity;
    let eccentricAnomaly = eccentricity > .8 ? Math.PI : meanAnomaly;

    for (let iteration = 0; iteration < 12; iteration += 1) {
        eccentricAnomaly -= (
            eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly
        ) / (1 - eccentricity * Math.cos(eccentricAnomaly));
    }

    const orbitalX = semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity);
    const orbitalY = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) *
        Math.sin(eccentricAnomaly);
    const argument = satellite.argumentOfPerigee * Math.PI / 180;
    const inclination = satellite.inclination * Math.PI / 180;
    const ascendingNode = satellite.ascendingNode * Math.PI / 180;
    const xPerigee = orbitalX * Math.cos(argument) - orbitalY * Math.sin(argument);
    const yPerigee = orbitalX * Math.sin(argument) + orbitalY * Math.cos(argument);
    const x = xPerigee * Math.cos(ascendingNode) -
        yPerigee * Math.cos(inclination) * Math.sin(ascendingNode);
    const y = xPerigee * Math.sin(ascendingNode) +
        yPerigee * Math.cos(inclination) * Math.cos(ascendingNode);
    const z = yPerigee * Math.sin(inclination);
    const radius = Math.hypot(x, y, z);

    return {
        x: x / radius,
        y: y / radius,
        z: z / radius,
        altitude: radius - EARTH_RADIUS_KM
    };
}

function drawSatelliteScene() {
    if (!satelliteCanvas) {
        return;
    }

    const bounds = satelliteCanvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
        return;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    satelliteCanvas.width = Math.round(bounds.width * pixelRatio);
    satelliteCanvas.height = Math.round(bounds.height * pixelRatio);
    const context = satelliteCanvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const width = bounds.width;
    const height = bounds.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const earthRadius = Math.min(width, height) * .19;
    const maximumOrbitRadius = Math.min(width, height) * .43;
    const maxAltitude = satelliteElements.reduce(
        (maximum, satellite) => Math.max(maximum, satellite.altitude),
        1
    );
    const yaw = -.48;
    const pitch = .42;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const now = Date.now();

    context.clearRect(0, 0, width, height);
    for (let index = 0; index < 65; index += 1) {
        const x = (index * 127.1 % 997) / 997 * width;
        const y = (index * 311.7 % 991) / 991 * height;
        context.fillStyle = index % 7 === 0 ? "rgba(124, 232, 255, .48)" : "rgba(220, 242, 255, .28)";
        context.fillRect(x, y, 1, 1);
    }

    context.save();
    context.strokeStyle = "rgba(124, 232, 255, .18)";
    context.lineWidth = 1;
    [1.23, 1.55, 1.88].forEach((scale, index) => {
        context.beginPath();
        context.ellipse(
            centerX,
            centerY,
            earthRadius * scale,
            earthRadius * scale * .46,
            index === 1 ? -.22 : .16,
            0,
            Math.PI * 2
        );
        context.stroke();
    });

    const projected = satelliteElements.map((satellite) => {
        const position = getSatellitePosition(satellite, now);
        const altitudeRatio = Math.log1p(Math.max(0, position.altitude) / EARTH_RADIUS_KM) /
            Math.log1p(Math.max(1, maxAltitude) / EARTH_RADIUS_KM);
        const displayRadius = earthRadius +
            (maximumOrbitRadius - earthRadius) * altitudeRatio;
        const rotatedX = position.x * cosYaw - position.z * sinYaw;
        const depth = position.x * sinYaw + position.z * cosYaw;
        const rotatedY = position.y * cosPitch - depth * sinPitch;
        const screenX = centerX + rotatedX * displayRadius;
        const screenY = centerY + rotatedY * displayRadius;
        const screenDistance = Math.hypot(screenX - centerX, screenY - centerY);
        const orbitClass = position.altitude < 2000
            ? "low"
            : position.altitude < 35786 ? "medium" : "high";

        return { screenX, screenY, depth, screenDistance, orbitClass };
    });

    function drawSatellite(point, isFront) {
        if (!isFront && point.screenDistance < earthRadius * 1.02) {
            return;
        }

        context.globalAlpha = isFront ? .88 : .3;
        context.fillStyle = ORBIT_COLORS[point.orbitClass];
        context.beginPath();
        context.arc(point.screenX, point.screenY, isFront ? 1.7 : 1.15, 0, Math.PI * 2);
        context.fill();
    }

    projected.filter((point) => point.depth <= 0).forEach((point) => drawSatellite(point, false));

    context.globalAlpha = 1;
    drawEarth(context, centerX, centerY, earthRadius);

    projected.filter((point) => point.depth > 0).forEach((point) => drawSatellite(point, true));
    context.restore();
}

function stopEpicAnimation() {
    if (epicInterval !== null) {
        window.clearInterval(epicInterval);
        epicInterval = null;
    }
}

function showEpicFrame(index) {
    if (epicImages.length === 0) return;
    epicIndex = (index + epicImages.length) % epicImages.length;
    const image = epicImages[epicIndex];
    epicImage.src = image.image;
    epicImage.hidden = false;
    const date = formatTime(image.date, true) || image.date;
    epicCaption.textContent =
        `${epicIndex + 1} of ${epicImages.length} · ${date} · ${image.caption}`;
}

function playEpicAnimation() {
    if (epicImages.length === 0) return;
    stopEpicAnimation();
    epicPlay.textContent = "Pause animation";
    epicInterval = window.setInterval(() => {
        showEpicFrame(epicIndex + 1);
    }, 2200);
}

async function refreshEpic() {
    if (isLoadingEpic) return;
    isLoadingEpic = true;
    epicRefresh.disabled = true;
    epicPlay.disabled = true;
    epicStatus.classList.remove("is-warning");
    epicStatus.textContent = "Loading the latest Earth images…";
    stopEpicAnimation();

    try {
        const response = await fetch("/api/epic", {
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await readResponse(response);
        if (!Array.isArray(data.images) || data.images.length === 0) {
            throw new Error("NASA EPIC returned no Earth images.");
        }

        epicImages = data.images.slice().sort((left, right) =>
            String(left.date).localeCompare(String(right.date))
        );
        epicIndex = 0;
        showEpicFrame(0);
        epicPrev.disabled = epicImages.length < 2;
        epicNext.disabled = epicImages.length < 2;
        epicPlay.disabled = epicImages.length < 2;
        epicStatus.textContent =
            `One DSCOVR EPIC image per available day · Updated ${formatTime(data.generatedAt, true)}.`;

        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            playEpicAnimation();
        } else {
            epicPlay.textContent = "Play animation";
        }
    } catch (error) {
        console.error("Unable to refresh NASA EPIC images.", error);
        epicStatus.textContent = error.message;
        epicStatus.classList.add("is-warning");
        epicImage.hidden = true;
        epicCaption.textContent = "Earth images are temporarily unavailable.";
    } finally {
        isLoadingEpic = false;
        epicRefresh.disabled = false;
    }
}

async function refreshSatellites() {
    if (isLoadingSatellites) {
        return;
    }

    isLoadingSatellites = true;
    satelliteRefresh.disabled = true;
    satelliteStatus.classList.remove("satellite-status-error");
    satelliteStatus.textContent = "Loading CelesTrak last-30-days orbital data…";

    try {
        const response = await fetch("/api/satellites", {
            headers: { Accept: "application/json" }
        });
        const data = await readResponse(response);
        if (!Array.isArray(data.satellites) || data.satellites.length === 0) {
            throw new Error("No CelesTrak last-30-days orbital data was provided.");
        }

        satelliteElements = data.satellites
            .filter((satellite) =>
                Number.isFinite(Date.parse(satellite.epoch)) &&
                Number.isFinite(satellite.meanMotion) &&
                satellite.meanMotion > 0 &&
                Number.isFinite(satellite.eccentricity) &&
                satellite.eccentricity >= 0 &&
                satellite.eccentricity < 1
            )
            .map((satellite) => {
                const meanMotion = satellite.meanMotion * (2 * Math.PI) / 86400;
                const semiMajorAxis = Math.cbrt(
                    EARTH_MU_KM3_PER_S2 / (meanMotion * meanMotion)
                );
                return {
                    ...satellite,
                    altitude: semiMajorAxis * (1 - satellite.eccentricity) - EARTH_RADIUS_KM
                };
            });

        if (satelliteElements.length === 0) {
            throw new Error("No valid last-30-days orbital elements were provided.");
        }

        satelliteCount.textContent = formatNumber(satelliteElements.length);
        satelliteStatus.textContent =
            `Positions estimated from CelesTrak last-30-days orbital elements · Updated ${formatTime(data.generatedAt, true)}.`;
        drawSatelliteScene();
    } catch (error) {
        console.error("Unable to load CelesTrak last-30-days satellite data.", error);
        satelliteStatus.textContent =
            `Recent satellite positions unavailable; showing the Earth/orbit guide. ${error.message}`;
        satelliteStatus.classList.add("satellite-status-error");
    } finally {
        isLoadingSatellites = false;
        satelliteRefresh.disabled = false;
    }
}

epicRefresh.addEventListener("click", refreshEpic);
epicPrev.addEventListener("click", () => {
    stopEpicAnimation();
    epicPlay.textContent = "Play animation";
    showEpicFrame(epicIndex - 1);
});
epicNext.addEventListener("click", () => {
    stopEpicAnimation();
    epicPlay.textContent = "Play animation";
    showEpicFrame(epicIndex + 1);
});
epicPlay.addEventListener("click", () => {
    if (epicInterval === null) {
        playEpicAnimation();
    } else {
        stopEpicAnimation();
        epicPlay.textContent = "Play animation";
    }
});
satelliteRefresh.addEventListener("click", refreshSatellites);
window.addEventListener("resize", () => {
    drawSatelliteScene();
});
drawSatelliteScene();
refreshEpic();
refreshSatellites();

function createTimelinePlayer({
    prefix,
    endpoint,
    colors,
    labels,
    types,
    describe,
    onDataLoaded,
    onLoadError
}) {
    const element = (suffix) => document.querySelector(`#${prefix}-${suffix}`);
    const player = element("player");
    const canvas = element("canvas");
    const dateReadout = element("date");
    const badge = element("badge");
    const detail = element("detail");
    const playButton = element("play");
    const restartButton = element("restart");
    const scrubber = element("scrubber");
    const rangeLabel = element("range-label");
    const speedSelect = element("speed");
    const flareImagePanel = element("flare-image");
    const flareImageTitle = element("flare-image-title");
    const flareImageStatus = element("flare-image-status");
    const flareImageLink = element("flare-image-link");
    const flareImage = element("flare-image-element");
    const flareImageCaption = element("flare-image-caption");

    let events = [];
    let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stepInterval = Number(speedSelect.value);
    let lastStepTime = 0;
    let playbackIndex = 0;
    let selectedIndex = -1;
    let minTimestamp = 0;
    let maxTimestamp = 1;
    let stars = [];
    let flareImageController = null;
    let flareImageRequest = 0;
    const played = new Set();
    const pulses = [];
    playButton.textContent = playing ? "Pause" : "Play";
    if (flareImage) {
        flareImage.addEventListener("error", () => {
            if (flareImage.dataset.requestId !== String(flareImageRequest)) return;
            flareImage.hidden = true;
            flareImageLink.hidden = true;
            flareImageStatus.textContent =
                "Helioviewer found a matching image, but it could not be downloaded.";
        });
    }

    function eventColor(event) {
        return colors[`${event.type}:${event.flareBand}`] || colors[event.type] || "#38bdf8";
    }

    function clearFlareImage() {
        flareImageRequest += 1;
        if (flareImageController) {
            flareImageController.abort();
            flareImageController = null;
        }
        flareImageLink.hidden = true;
        flareImage.hidden = true;
        delete flareImage.dataset.requestId;
        flareImage.removeAttribute("src");
        flareImageCaption.textContent =
            "Helioviewer images are selected from the SDO/AIA 131 Å channel nearest to the flare time.";
    }

    async function loadFlareImage(event) {
        if (!flareImagePanel) return;
        if (event.type !== "FLR") {
            clearFlareImage();
            flareImageTitle.textContent = "Solar flare imagery";
            flareImageStatus.textContent = "Select a DONKI solar flare to load the nearest image.";
            flareImagePanel.setAttribute("aria-busy", "false");
            return;
        }
        if (playing) {
            clearFlareImage();
            flareImageStatus.textContent = "Pause playback to load an image for this flare.";
            flareImagePanel.setAttribute("aria-busy", "false");
            return;
        }

        clearFlareImage();
        const requestId = flareImageRequest;
        flareImageController = new AbortController();
        flareImageTitle.textContent = `${event.flareClass || "DONKI"} flare`;
        flareImageStatus.textContent = "Finding the closest SDO/AIA image…";
        flareImagePanel.setAttribute("aria-busy", "true");

        try {
            const date = new Date(event.timestamp).toISOString();
            const response = await fetch(`/api/helioviewer?date=${encodeURIComponent(date)}`, {
                headers: { Accept: "application/json" },
                signal: flareImageController.signal
            });
            const data = await readResponse(response);
            if (requestId !== flareImageRequest) return;

            flareImageLink.href = data.imageUrl;
            flareImageLink.hidden = false;
            flareImage.alt = `${data.imageName} image nearest to ${data.imageAt} UTC`;
            flareImage.dataset.requestId = String(requestId);
            flareImage.src = data.imageUrl;
            flareImage.hidden = false;
            flareImageCaption.textContent =
                `${data.imageName} · image time ${data.imageAt} UTC · `;
            const attribution = document.createElement("a");
            attribution.href = data.attributionUrl;
            attribution.target = "_blank";
            attribution.rel = "noopener noreferrer";
            attribution.textContent = "Helioviewer";
            flareImageCaption.append(attribution);
            flareImageStatus.textContent = "Nearest available image for the selected flare.";
        } catch (error) {
            if (error.name === "AbortError" || requestId !== flareImageRequest) return;
            console.error("Unable to load Helioviewer image for DONKI flare.", error);
            flareImageStatus.textContent = error.message;
        } finally {
            if (requestId === flareImageRequest) {
                flareImagePanel.setAttribute("aria-busy", "false");
                flareImageController = null;
            }
        }
    }

    function resize() {
        const bounds = canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(bounds.width * pixelRatio);
        canvas.height = Math.round(bounds.height * pixelRatio);
        canvas.getContext("2d").setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        stars = Array.from({ length: 120 }, () => ({
            x: Math.random() * bounds.width,
            y: Math.random() * bounds.height,
            radius: Math.random() * 1.2 + .25,
            alpha: Math.random() * .5 + .15
        }));
    }

    function eventY(type, height) {
        const lane = Math.max(0, types.indexOf(type));
        return height * .52 + (lane - (types.length - 1) / 2) * 70;
    }

    function showEvent(index) {
        const event = events[index];
        if (!event) return;
        selectedIndex = index;
        playbackIndex = (index + 1) % events.length;
        played.add(index);
        dateReadout.textContent = `${event.date} ${event.time} UTC`;
        badge.textContent = event.flareClass
            ? `${event.flareClass} flare`
            : labels[event.type] || event.type;
        badge.style.color = eventColor(event);
        detail.textContent = event.detail;
        scrubber.value = String(index);
        if (flareImagePanel) loadFlareImage(event);

        const bounds = canvas.getBoundingClientRect();
        const margin = Math.min(60, bounds.width * .08);
        const fraction = (event.timestamp - minTimestamp) / (maxTimestamp - minTimestamp || 1);
        pulses.push({
            x: margin + fraction * Math.max(1, bounds.width - margin * 2),
            y: eventY(event.type, bounds.height),
            color: eventColor(event),
            radius: 4,
            maxRadius: 18 + (event.intensity || 1) * 5,
            alpha: 1
        });
    }

    function render(now) {
        window.requestAnimationFrame(render);
        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const context = canvas.getContext("2d");

        if (playing && events.length && now - lastStepTime >= stepInterval) {
            showEvent(playbackIndex);
            lastStepTime = now;
        }

        context.fillStyle = "rgba(5, 7, 14, .24)";
        context.fillRect(0, 0, bounds.width, bounds.height);
        stars.forEach((star) => {
            context.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
            context.beginPath();
            context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            context.fill();
        });

        const margin = Math.min(60, bounds.width * .08);
        types.forEach((type) => {
            const y = eventY(type, bounds.height);
            context.strokeStyle = "rgba(255, 255, 255, .08)";
            context.beginPath();
            context.moveTo(margin, y);
            context.lineTo(bounds.width - margin, y);
            context.stroke();
        });

        events.forEach((event, index) => {
            if (!played.has(index)) return;
            const fraction = (event.timestamp - minTimestamp) / (maxTimestamp - minTimestamp || 1);
            const x = margin + fraction * Math.max(1, bounds.width - margin * 2);
            context.fillStyle = eventColor(event);
            context.globalAlpha = index === selectedIndex ? 1 : .35;
            context.beginPath();
            const baseRadius = event.markerRadius || 2.5;
            const markerRadius = event.markerRadius
                ? baseRadius + (index === selectedIndex ? 2 : 0)
                : index === selectedIndex ? 5 : baseRadius;
            context.shadowColor = eventColor(event);
            context.shadowBlur = index === selectedIndex ? markerRadius * 1.5 : 0;
            context.arc(x, eventY(event.type, bounds.height), markerRadius, 0, Math.PI * 2);
            context.fill();
        });
        context.shadowBlur = 0;
        context.globalAlpha = 1;

        for (let index = pulses.length - 1; index >= 0; index -= 1) {
            const pulse = pulses[index];
            pulse.radius += (pulse.maxRadius - pulse.radius) * .08;
            pulse.alpha -= .018;
            if (pulse.alpha <= 0) {
                pulses.splice(index, 1);
                continue;
            }
            context.strokeStyle = pulse.color;
            context.globalAlpha = pulse.alpha;
            context.lineWidth = 2;
            context.beginPath();
            context.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            context.stroke();
        }
        context.globalAlpha = 1;
    }

    async function load() {
        try {
            const response = await fetch(endpoint, {
                headers: { Accept: "application/json" },
                cache: "no-store"
            });
            const data = await readResponse(response);
            events = Array.isArray(data.events)
                ? data.events.slice().sort((left, right) => left.timestamp - right.timestamp)
                : [];
            if (onDataLoaded) onDataLoaded(data, events);
            if (events.length === 0) {
                rangeLabel.textContent = data.emptyMessage || "No timeline events were returned.";
                player.setAttribute("aria-busy", "false");
                playButton.disabled = true;
                restartButton.disabled = true;
                scrubber.disabled = true;
                speedSelect.disabled = true;
                return;
            }

            minTimestamp = events[0].timestamp;
            maxTimestamp = events[events.length - 1].timestamp;
            scrubber.max = String(events.length - 1);
            rangeLabel.textContent = describe(data, events);
            player.setAttribute("aria-busy", "false");
            playButton.disabled = false;
            restartButton.disabled = false;
            scrubber.disabled = false;
            speedSelect.disabled = false;
            resize();
            showEvent(0);
            window.requestAnimationFrame(render);
        } catch (error) {
            console.error(`Unable to load timeline from ${endpoint}.`, error);
            rangeLabel.textContent = error.message;
            if (onLoadError) onLoadError(error);
            player.setAttribute("aria-busy", "false");
            playButton.disabled = true;
            restartButton.disabled = true;
            scrubber.disabled = true;
            speedSelect.disabled = true;
        }
    }

    playButton.addEventListener("click", () => {
        playing = !playing;
        playButton.textContent = playing ? "Pause" : "Play";
        if (!playing && selectedIndex >= 0) loadFlareImage(events[selectedIndex]);
    });
    restartButton.addEventListener("click", () => {
        played.clear();
        pulses.length = 0;
        playbackIndex = 0;
        showEvent(0);
    });
    scrubber.addEventListener("input", () => {
        playing = false;
        playButton.textContent = "Play";
        showEvent(Number(scrubber.value));
    });
    speedSelect.addEventListener("change", () => {
        stepInterval = Number(speedSelect.value);
    });
    window.addEventListener("resize", resize);
    resize();
    load();
}

function createNoaaFlareImagePlayer() {
    const prefix = "swpc-flare-image";
    const element = (suffix) => document.querySelector(`#${prefix}-${suffix}`);
    const panel = document.querySelector(`#${prefix}`);
    const title = element("title");
    const status = element("status");
    const link = element("link");
    const image = element("element");
    const caption = element("caption");
    const previousButton = element("previous");
    const playButton = element("play");
    const nextButton = element("next");
    const count = element("count");
    const imageDelay = 3500;

    let flares = [];
    let selectedIndex = 0;
    let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let requestId = 0;
    let controller = null;
    let imageTimer = null;
    let settleImageLoad = null;
    const imageCache = new Map();

    function updatePlayButton() {
        playButton.textContent = playing ? "Pause animation" : "Play animation";
    }

    function scheduleNext() {
        window.clearTimeout(imageTimer);
        if (!playing || flares.length < 2) return;
        imageTimer = window.setTimeout(() => showImage(selectedIndex + 1), imageDelay);
    }

    function setError(message) {
        window.clearTimeout(imageTimer);
        if (controller) controller.abort();
        requestId += 1;
        panel.setAttribute("aria-busy", "false");
        status.textContent = message;
        playButton.disabled = true;
        previousButton.disabled = true;
        nextButton.disabled = true;
    }

    async function showImage(index) {
        if (flares.length === 0) return;
        window.clearTimeout(imageTimer);
        if (controller) {
            controller.abort();
            controller = null;
        }
        if (settleImageLoad) {
            settleImageLoad(false);
            settleImageLoad = null;
        }

        selectedIndex = (index + flares.length) % flares.length;
        const event = flares[selectedIndex];
        const currentRequest = ++requestId;
        const date = new Date(event.timestamp).toISOString();
        controller = new AbortController();
        panel.setAttribute("aria-busy", "true");
        title.textContent = `${event.flareClass || "GOES"} flare`;
        status.textContent = "Finding the closest SDO/AIA image…";
        count.textContent = `${selectedIndex + 1} / ${flares.length}`;
        link.hidden = true;
        image.hidden = true;

        try {
            let data = imageCache.get(date);
            if (!data) {
                const response = await fetch(`/api/helioviewer?date=${encodeURIComponent(date)}`, {
                    headers: { Accept: "application/json" },
                    signal: controller.signal
                });
                data = await readResponse(response);
                imageCache.set(date, data);
            }
            if (currentRequest !== requestId) return;

            link.href = data.imageUrl;
            link.hidden = false;
            image.alt =
                `${data.imageName} image nearest to NOAA flare at ${event.date} ${event.time} UTC`;
            caption.textContent = `${data.imageName} · image time ${data.imageAt} UTC · `;
            const attribution = document.createElement("a");
            attribution.href = data.attributionUrl;
            attribution.target = "_blank";
            attribution.rel = "noopener noreferrer";
            attribution.textContent = "Helioviewer";
            caption.append(attribution);

            const imageLoaded = new Promise((resolve) => {
                settleImageLoad = resolve;
                image.onload = () => resolve(true);
                image.onerror = () => resolve(false);
                image.src = data.imageUrl;
                image.hidden = false;
                if (image.complete) resolve(image.naturalWidth > 0);
            });
            const loaded = await imageLoaded;
            if (currentRequest !== requestId) return;
            settleImageLoad = null;
            if (!loaded) throw new Error("The matching Helioviewer image could not be downloaded.");
            status.textContent = `Flare time ${event.date} ${event.time} UTC · image ${data.imageAt} UTC`;
        } catch (error) {
            if (error.name === "AbortError" || currentRequest !== requestId) return;
            console.error("Unable to load Helioviewer image for NOAA flare.", error);
            status.textContent = error.message;
        } finally {
            if (currentRequest === requestId) {
                panel.setAttribute("aria-busy", "false");
                controller = null;
                settleImageLoad = null;
                scheduleNext();
            }
        }
    }

    previousButton.addEventListener("click", () => showImage(selectedIndex - 1));
    nextButton.addEventListener("click", () => showImage(selectedIndex + 1));
    playButton.addEventListener("click", () => {
        playing = !playing;
        updatePlayButton();
        if (playing && panel.getAttribute("aria-busy") === "false") {
            scheduleNext();
        } else {
            window.clearTimeout(imageTimer);
        }
    });
    updatePlayButton();

    return {
        setEvents(data, events) {
            flares = events.filter((event) => event.type === "FLR");
            panel.setAttribute("aria-busy", "false");
            previousButton.disabled = flares.length < 2;
            nextButton.disabled = flares.length < 2;
            playButton.disabled = flares.length < 2;
            count.textContent = flares.length ? `1 / ${flares.length}` : "0 / 0";
            if (flares.length === 0) {
                playing = false;
                updatePlayButton();
                title.textContent = "NOAA flare images";
                status.textContent = "No C-class or stronger flares were detected in this 7-day window.";
                caption.textContent = `${data.startDate} to ${data.endDate}`;
                return;
            }
            playing = playing && flares.length > 1;
            updatePlayButton();
            status.textContent =
                `${data.startDate} to ${data.endDate} · ${flares.length} NOAA flares`;
            showImage(0);
        },
        setError(message) {
            setError(`Unable to load NOAA flare timestamps: ${message}`);
        }
    };
}

const noaaFlareImagePlayer = createNoaaFlareImagePlayer();

createTimelinePlayer({
    prefix: "swpc-timeline",
    endpoint: "/api/noaa-flares",
    colors: {
        FLR: "#7ce8ff",
        "FLR:C": "#7ce8ff",
        "FLR:M": "#ffb347",
        "FLR:X": "#ff4d8d"
    },
    labels: { FLR: "GOES X-ray flare" },
    types: ["FLR"],
    onDataLoaded: (data, events) => noaaFlareImagePlayer.setEvents(data, events),
    onLoadError: (error) => noaaFlareImagePlayer.setError(error.message),
    describe: (data) =>
        `${data.startDate} to ${data.endDate} · ${data.eventCount} C-class or stronger flares · ${formatNumber(data.sampleCount)} X-ray samples`
});

createTimelinePlayer({
    prefix: "timeline",
    endpoint: "/api/timeline",
    colors: { FLR: "#ff9f1c", HSS: "#00f5d4", GST: "#f72585" },
    labels: { FLR: "Solar flare", HSS: "High-speed stream", GST: "Geomagnetic storm" },
    types: ["FLR", "HSS", "GST"],
    describe: (data) => {
        const counts = data.counts || {};
        let label =
            `${data.startDate} to ${data.endDate} · ` +
            `${counts.FLR || 0} FLR · ${counts.HSS || 0} HSS · ${counts.GST || 0} GST`;
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            const failedTypes = ["FLR", "HSS", "GST"]
                .map((type) => ({
                    type,
                    failed: data.warnings.filter((warning) => warning.startsWith(`${type} `)).length
                }))
                .filter((entry) => entry.failed > 0)
                .map((entry) => `${entry.failed} ${entry.type} chunk${entry.failed === 1 ? "" : "s"} unavailable`);
            label += ` · ${failedTypes.join(", ")}`;
        }
        return label;
    }
});
