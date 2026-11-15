const refreshButton = document.querySelector("#refresh-button");
const metricGrid = document.querySelector("#metric-grid");
const liveIndicator = document.querySelector("#live-indicator");
const connectionStatus = document.querySelector("#connection-status");
const lastUpdated = document.querySelector("#last-updated");
const noaaNote = document.querySelector("#noaa-note");
const forecastStatus = document.querySelector("#forecast-status");
const forecastList = document.querySelector("#forecast-list");
const eventsStatus = document.querySelector("#events-status");
const eventList = document.querySelector("#event-list");

let isLoading = false;

function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    const number = Number(value);
    return Number.isFinite(number)
        ? number.toLocaleString(undefined, {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        })
        : "—";
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

function renderForecast(forecast) {
    forecastList.replaceChildren();

    if (!Array.isArray(forecast) || forecast.length === 0) {
        forecastStatus.textContent = "NOAA has not returned forecast intervals.";
        return;
    }

    forecastStatus.textContent = `${forecast.length} upcoming intervals`;
    forecast.forEach((item) => {
        const kp = Number(item.kp);
        if (!Number.isFinite(kp)) {
            return;
        }

        const row = document.createElement("li");
        row.className = "forecast-item";

        const time = document.createElement("time");
        time.className = "forecast-time";
        time.dateTime = item.time || "";
        time.textContent = formatTime(item.time, true) || "Forecast";

        const value = document.createElement("span");
        value.className = "forecast-value";
        value.textContent = kp.toFixed(1);

        const scale = document.createElement("span");
        scale.className = "forecast-scale";
        scale.textContent = item.scale || "Kp";

        const meter = document.createElement("span");
        meter.className = "forecast-meter";
        meter.setAttribute("aria-hidden", "true");

        const fill = document.createElement("span");
        fill.className = "forecast-meter-fill";
        fill.style.width = `${Math.max(0, Math.min(100, (kp / 9) * 100))}%`;
        meter.append(fill);

        row.append(time, value, scale, meter);
        forecastList.append(row);
    });

    if (forecastList.childElementCount === 0) {
        forecastStatus.textContent = "NOAA returned forecast data in an unsupported format.";
    }
}

function createEventCard(event) {
    const card = document.createElement("article");
    card.className = "event-card";

    const type = document.createElement("p");
    type.className = "event-type";
    type.textContent = event.type || "SOLAR EVENT";

    const title = document.createElement("h3");
    title.textContent = event.title || "Solar activity";

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

    return card;
}

function renderEvents(events, errors) {
    eventList.replaceChildren();

    if (Array.isArray(events) && events.length > 0) {
        eventList.append(...events.map(createEventCard));
    }

    const nasaErrors = Array.isArray(errors) ? errors : [];
    if (nasaErrors.length > 0) {
        eventsStatus.textContent = nasaErrors.join(" ");
        eventsStatus.classList.add("is-warning");
    } else if (eventList.childElementCount === 0) {
        eventsStatus.textContent = "No NASA solar events were reported in the past 7 days.";
        eventsStatus.classList.remove("is-warning");
    } else {
        eventsStatus.textContent = `${eventList.childElementCount} recent NASA events`;
        eventsStatus.classList.remove("is-warning");
    }
}

function renderDashboard(data) {
    const readings = data.readings || {};
    document.querySelector("#solar-wind-speed").textContent = formatNumber(readings.solarWindSpeed);
    document.querySelector("#proton-density").textContent = formatNumber(readings.protonDensity, 1);
    document.querySelector("#kp-index").textContent = formatNumber(readings.kp, 1);
    document.querySelector("#bz-value").textContent = formatNumber(readings.bz, 1);

    const scaleBadge = document.querySelector("#kp-scale");
    scaleBadge.textContent = readings.kpScale || "NOAA SCALE —";
    scaleBadge.dataset.level = Number(readings.kp) >= 5 ? "storm" : "quiet";

    const generatedAt = data.generatedAt || new Date().toISOString();
    lastUpdated.dateTime = generatedAt;
    lastUpdated.textContent = formatTime(generatedAt, true);

    const noaaErrors = Array.isArray(data.errors?.noaa) ? data.errors.noaa : [];
    if (noaaErrors.length > 0) {
        noaaNote.textContent = `Some NOAA readings are unavailable: ${noaaErrors.join(" ")}`;
        noaaNote.classList.add("is-warning");
        connectionStatus.textContent = "Partial space-weather data";
        liveIndicator.dataset.state = "warning";
    } else {
        noaaNote.textContent = readings.solarWindTime
            ? `Latest solar-wind observation: ${formatTime(readings.solarWindTime, true)}`
            : "Live readings are provided by NOAA SWPC.";
        noaaNote.classList.remove("is-warning");
        connectionStatus.textContent = "Live solar-wind and geomagnetic readings";
        liveIndicator.dataset.state = "live";
    }

    renderForecast(data.forecast);
    renderEvents(data.events, data.errors?.nasa);
}

async function refreshDashboard() {
    if (isLoading) {
        return;
    }

    setLoading(true);
    connectionStatus.textContent = "Updating space-weather data…";
    liveIndicator.dataset.state = "loading";

    try {
        const response = await fetch("/api/space-weather", {
            headers: { Accept: "application/json" },
            cache: "no-store"
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Space-weather service returned HTTP ${response.status}.`);
        }

        renderDashboard(data);
    } catch (error) {
        console.error("Unable to refresh space-weather data.", error);
        connectionStatus.textContent = "Space-weather data is temporarily unavailable.";
        liveIndicator.dataset.state = "error";
        noaaNote.textContent = error.message;
        noaaNote.classList.add("is-warning");
        forecastStatus.textContent = "Forecast data is unavailable.";
        eventsStatus.textContent = "NASA event data is unavailable.";
        eventsStatus.classList.add("is-warning");
    } finally {
        setLoading(false);
    }
}

refreshButton.addEventListener("click", refreshDashboard);
refreshDashboard();
window.setInterval(refreshDashboard, 5 * 60 * 1000);
