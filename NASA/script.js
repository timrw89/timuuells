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
const satelliteCanvas = document.querySelector("#satellite-canvas");
const satelliteStatus = document.querySelector("#satellite-status");
const satelliteCount = document.querySelector("#satellite-count");
const satelliteRefresh = document.querySelector("#satellite-refresh");

let isLoading = false;
let isLoadingAnimation = false;
let isLoadingSatellites = false;
let animationAlertTime = "";
let animationRequestId = 0;
let animationFrames = [];
let animationFrameIndex = 0;
let animationInterval = null;
let satelliteElements = [];

const EARTH_RADIUS_KM = 6371;
const EARTH_MU_KM3_PER_S2 = 398600.4418;
const ORBIT_COLORS = {
    low: "#7ce8ff",
    medium: "#c6f36b",
    high: "#ffb27b"
};

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
    if (!satelliteCanvas || satelliteElements.length === 0) {
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
    const earthGradient = context.createRadialGradient(
        centerX - earthRadius * .36,
        centerY - earthRadius * .4,
        earthRadius * .06,
        centerX,
        centerY,
        earthRadius * 1.08
    );
    earthGradient.addColorStop(0, "#3b9ab8");
    earthGradient.addColorStop(.55, "#155276");
    earthGradient.addColorStop(1, "#07172c");
    context.shadowColor = "rgba(83, 197, 255, .38)";
    context.shadowBlur = 22;
    context.fillStyle = earthGradient;
    context.beginPath();
    context.arc(centerX, centerY, earthRadius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, earthRadius, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = "rgba(151, 231, 255, .19)";
    context.lineWidth = 1;
    [-.56, 0, .56].forEach((offset) => {
        context.beginPath();
        context.ellipse(
            centerX,
            centerY,
            earthRadius * Math.sqrt(1 - offset * offset),
            earthRadius * .19,
            0,
            0,
            Math.PI * 2
        );
        context.stroke();
    });
    context.beginPath();
    context.ellipse(centerX, centerY, earthRadius * .38, earthRadius, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();

    projected.filter((point) => point.depth > 0).forEach((point) => drawSatellite(point, true));
    context.restore();
}

async function refreshSatellites() {
    if (isLoadingSatellites) {
        return;
    }

    isLoadingSatellites = true;
    satelliteRefresh.disabled = true;
    satelliteStatus.classList.remove("satellite-status-error");
    satelliteStatus.textContent = "Loading active satellite orbital data…";

    try {
        const response = await fetch("/api/satellites", {
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await readResponse(response);
        if (!Array.isArray(data.satellites) || data.satellites.length === 0) {
            throw new Error("No active satellite orbital data was provided.");
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
            throw new Error("No valid active satellite orbital elements were provided.");
        }

        satelliteCount.textContent = formatNumber(satelliteElements.length);
        satelliteStatus.textContent =
            `Positions estimated from CelesTrak active orbital elements · Updated ${formatTime(data.generatedAt, true)}.`;
        drawSatelliteScene();
    } catch (error) {
        console.error("Unable to load active satellite data.", error);
        satelliteStatus.textContent = error.message;
        satelliteStatus.classList.add("satellite-status-error");
    } finally {
        isLoadingSatellites = false;
        satelliteRefresh.disabled = false;
    }
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
satelliteRefresh.addEventListener("click", refreshSatellites);
window.addEventListener("resize", drawSatelliteScene);
refreshDashboard();
refreshSatellites();
window.setInterval(refreshDashboard, 5 * 60 * 1000);
