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

const timelineCanvas = document.querySelector("#timeline-canvas");
const timelinePlayer = document.querySelector("#timeline-player");
const timelineDate = document.querySelector("#timeline-date");
const timelineBadge = document.querySelector("#timeline-badge");
const timelineDetail = document.querySelector("#timeline-detail");
const timelinePlay = document.querySelector("#timeline-play");
const timelineRestart = document.querySelector("#timeline-restart");
const timelineScrubber = document.querySelector("#timeline-scrubber");
const timelineRangeLabel = document.querySelector("#timeline-range-label");
const timelineSpeed = document.querySelector("#timeline-speed");

const timelineColors = { FLR: "#ff9f1c", HSS: "#00f5d4", GST: "#f72585" };
const timelineLabels = { FLR: "Solar flare", HSS: "High-speed stream", GST: "Geomagnetic storm" };
let timelineEvents = [];
let timelineIndex = 0;
let timelinePlaying = true;
let timelineStepMs = 280;
let timelineLastStep = 0;
let timelinePulses = [];
let timelineStars = [];
let timelineMin = 0;
let timelineMax = 1;

function resizeTimeline() {
    if (!timelineCanvas) return;
    const bounds = timelineCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    timelineCanvas.width = Math.round(bounds.width * dpr);
    timelineCanvas.height = Math.round(bounds.height * dpr);
    const context = timelineCanvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    timelineStars = Array.from({ length: 120 }, () => ({
        x: Math.random() * bounds.width,
        y: Math.random() * bounds.height,
        r: Math.random() * 1.2 + .25,
        alpha: Math.random() * .5 + .15
    }));
}

function triggerTimelineEvent(index) {
    if (!timelineEvents[index]) return;
    const event = timelineEvents[index];
    timelineDate.textContent = `${event.date} ${event.time} UTC`;
    timelineBadge.textContent = timelineLabels[event.type] || event.type;
    timelineBadge.style.color = timelineColors[event.type];
    timelineDetail.textContent = event.detail;
    timelineScrubber.value = String(index);

    const width = timelineCanvas.getBoundingClientRect().width;
    const progress = (event.timestamp - timelineMin) / (timelineMax - timelineMin || 1);
    const x = 60 + progress * Math.max(1, width - 120);
    const centerY = 260;
    const laneY = centerY + (event.type === "FLR" ? -70 : event.type === "GST" ? 70 : 0);
    timelinePulses.push({
        x,
        y: laneY,
        color: timelineColors[event.type] || "#38bdf8",
        radius: 4,
        maxRadius: 18 + event.intensity * 5,
        alpha: 1
    });
}

function drawTimeline(now) {
    if (!timelineCanvas) return;
    window.requestAnimationFrame(drawTimeline);
    const bounds = timelineCanvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const context = timelineCanvas.getContext("2d");

    if (timelinePlaying && timelineEvents.length > 0 && now - timelineLastStep >= timelineStepMs) {
        triggerTimelineEvent(timelineIndex);
        timelineIndex = (timelineIndex + 1) % timelineEvents.length;
        timelineLastStep = now;
    }

    context.fillStyle = "rgba(5, 7, 14, .24)";
    context.fillRect(0, 0, bounds.width, bounds.height);
    timelineStars.forEach((star) => {
        context.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        context.beginPath();
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        context.fill();
    });

    const centerY = 260;
    const usableWidth = Math.max(1, bounds.width - 120);
    ["FLR", "HSS", "GST"].forEach((type) => {
        const laneY = centerY + (type === "FLR" ? -70 : type === "GST" ? 70 : 0);
        context.strokeStyle = "rgba(255, 255, 255, .08)";
        context.beginPath();
        context.moveTo(60, laneY);
        context.lineTo(bounds.width - 60, laneY);
        context.stroke();
    });

    timelineEvents.forEach((event, index) => {
        if (index > timelineIndex) return;
        const progress = (event.timestamp - timelineMin) / (timelineMax - timelineMin || 1);
        const x = 60 + progress * usableWidth;
        const laneY = centerY + (event.type === "FLR" ? -70 : event.type === "GST" ? 70 : 0);
        context.fillStyle = timelineColors[event.type] || "#38bdf8";
        context.globalAlpha = index === timelineIndex - 1 ? 1 : .35;
        context.beginPath();
        context.arc(x, laneY, index === timelineIndex - 1 ? 5 : 2.5, 0, Math.PI * 2);
        context.fill();
    });
    context.globalAlpha = 1;

    for (let index = timelinePulses.length - 1; index >= 0; index -= 1) {
        const pulse = timelinePulses[index];
        pulse.radius += (pulse.maxRadius - pulse.radius) * .08;
        pulse.alpha -= .018;
        if (pulse.alpha <= 0) {
            timelinePulses.splice(index, 1);
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

async function loadTimeline() {
    try {
        const response = await fetch("/api/timeline", {
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await readResponse(response);
        timelineEvents = Array.isArray(data.events) ? data.events : [];
        if (timelineEvents.length === 0) {
            timelineRangeLabel.textContent = "No space-weather events were returned.";
            timelinePlayer.setAttribute("aria-busy", "false");
            return;
        }
        timelineMin = timelineEvents[0].timestamp;
        timelineMax = timelineEvents[timelineEvents.length - 1].timestamp;
        timelineScrubber.max = String(timelineEvents.length - 1);
        timelineRangeLabel.textContent =
            `${data.startDate} to ${data.endDate} · ${timelineEvents.length} events`;
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            const flareWarning = data.warnings.some((warning) => warning.startsWith("FLR "));
            if (flareWarning) {
                timelineRangeLabel.textContent += " · Some FLR data unavailable";
            }
        }
        timelinePlayer.setAttribute("aria-busy", "false");
        resizeTimeline();
        triggerTimelineEvent(0);
        window.requestAnimationFrame(drawTimeline);
    } catch (error) {
        console.error("Unable to load NASA timeline.", error);
        timelineRangeLabel.textContent = error.message;
        timelinePlayer.setAttribute("aria-busy", "false");
    }
}

timelinePlay.addEventListener("click", () => {
    timelinePlaying = !timelinePlaying;
    timelinePlay.textContent = timelinePlaying ? "Pause" : "Play";
});
timelineRestart.addEventListener("click", () => {
    timelineIndex = 0;
    timelinePulses = [];
    triggerTimelineEvent(0);
});
timelineScrubber.addEventListener("input", (event) => {
    timelineIndex = Math.max(0, Math.min(timelineEvents.length - 1, Number(event.target.value)));
    triggerTimelineEvent(timelineIndex);
});
timelineSpeed.addEventListener("change", (event) => {
    timelineStepMs = Number(event.target.value);
});
window.addEventListener("resize", resizeTimeline);
resizeTimeline();
loadTimeline();
