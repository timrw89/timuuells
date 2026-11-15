const NOAA_FEEDS = [
    {
        name: "solarWind",
        source: "noaa",
        label: "Solar wind",
        url: "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json"
    },
    {
        name: "magneticField",
        source: "noaa",
        label: "Interplanetary magnetic field",
        url: "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json"
    },
    {
        name: "kpForecast",
        source: "noaa",
        label: "Geomagnetic forecast",
        url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
    }
];

function toRecords(payload) {
    if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[0])) {
        return [];
    }

    const headers = payload[0];
    return payload.slice(1).map((row) => {
        if (!Array.isArray(row)) {
            return null;
        }

        return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
    }).filter(Boolean);
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function latestRecord(records, predicate) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
        if (predicate(records[index])) {
            return records[index];
        }
    }

    return null;
}

async function fetchJson(url, label) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}.`);
    }

    return response.json();
}

function getDonkiUrl(type, startDate, endDate, apiKey) {
    const url = new URL(`https://api.nasa.gov/DONKI/${type}`);
    url.search = new URLSearchParams({ startDate, endDate, api_key: apiKey }).toString();
    return url;
}

function normalizeDonkiEvent(event, type) {
    const time = event.startTime || event.beginTime || event.peakTime || event.eventTime || "";
    let title = type;
    let summary = event.note || "";

    if (type === "SOLAR FLARE") {
        title = event.classType ? `Solar flare ${event.classType}` : "Solar flare";
        summary = [event.sourceLocation, event.note].filter(Boolean).join(" · ");
    } else if (type === "CORONAL MASS EJECTION") {
        const analysis = event.cmeAnalyses?.find((item) => item.isMostAccurate) || event.cmeAnalyses?.[0];
        title = "Coronal mass ejection";
        summary = analysis?.speed
            ? `Estimated speed: ${analysis.speed} km/s`
            : event.note || "";
    } else if (type === "GEOMAGNETIC STORM") {
        const kpValues = event.allKpIndex || [];
        const latestKp = kpValues[kpValues.length - 1]?.kpIndex;
        title = "Geomagnetic storm";
        summary = latestKp ? `Reported Kp index: ${latestKp}` : event.note || "";
    }

    return { type, title, time, summary };
}

function kpScale(value) {
    if (value < 5) return "G0";
    if (value < 6) return "G1";
    if (value < 7) return "G2";
    if (value < 8) return "G3";
    if (value < 9) return "G4";
    return "G5";
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

    const apiKey = process.env.nasa_api_key;
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tasks = NOAA_FEEDS.map((feed) => ({ ...feed, run: () => fetchJson(feed.url, feed.label) }));
    const nasaFeeds = [
        { name: "flares", type: "SOLAR FLARE" },
        { name: "cmes", type: "CORONAL MASS EJECTION" },
        { name: "storms", type: "GEOMAGNETIC STORM" }
    ];

    if (apiKey) {
        nasaFeeds.forEach((feed) => {
            const url = getDonkiUrl(feed.name === "flares" ? "FLR" : feed.name === "cmes" ? "CME" : "GST", startDate, endDate, apiKey);
            tasks.push({
                name: feed.name,
                source: "nasa",
                label: feed.type,
                run: () => fetchJson(url, feed.type)
            });
        });
    }

    try {
        const results = await Promise.allSettled(tasks.map((task) => task.run()));
        const data = {};
        const errors = { noaa: [], nasa: [] };

        results.forEach((result, index) => {
            const task = tasks[index];
            if (result.status === "fulfilled") {
                data[task.name] = result.value;
            } else {
                errors[task.source].push(`${task.label}: ${result.reason.message}`);
            }
        });

        if (!apiKey) {
            errors.nasa.push("Set nasa_api_key in the Vercel environment to load NASA event data.");
        }

        const noaaAvailable = NOAA_FEEDS.some((feed) => data[feed.name] !== undefined);
        if (!noaaAvailable) {
            return response.status(502).json({
                error: "NOAA space-weather feeds are unavailable.",
                details: errors.noaa
            });
        }

        const solarWindRecords = toRecords(data.solarWind);
        const magneticRecords = toRecords(data.magneticField);
        const kpRecords = toRecords(data.kpForecast);
        const solarWind = latestRecord(
            solarWindRecords,
            (record) => numberOrNull(record.speed) !== null || numberOrNull(record.density) !== null
        );
        const magnetic = latestRecord(
            magneticRecords,
            (record) => numberOrNull(record.bz_gsm) !== null
        );
        const observedKp = latestRecord(
            kpRecords,
            (record) => String(record.observed).toLowerCase() === "observed" && numberOrNull(record.Kp) !== null
        );
        const currentKp = observedKp || latestRecord(kpRecords, (record) => numberOrNull(record.Kp) !== null);
        const forecast = kpRecords
            .filter((record) =>
                String(record.observed).toLowerCase() !== "observed" &&
                numberOrNull(record.Kp) !== null
            )
            .slice(0, 8)
            .map((record) => {
                const value = numberOrNull(record.Kp);
                return {
                    time: record.time_tag || "",
                    kp: value,
                    scale: record.noaa_scale || kpScale(value)
                };
            });

        const events = [];
        for (const feed of nasaFeeds) {
            const records = data[feed.name];
            if (Array.isArray(records)) {
                events.push(...records.map((event) => normalizeDonkiEvent(event, feed.type)));
            }
        }

        events.sort((left, right) => new Date(right.time) - new Date(left.time));

        return response.status(200).json({
            generatedAt: new Date().toISOString(),
            readings: {
                solarWindSpeed: numberOrNull(solarWind?.speed),
                protonDensity: numberOrNull(solarWind?.density),
                solarWindTime: solarWind?.time_tag || "",
                bz: numberOrNull(magnetic?.bz_gsm),
                kp: numberOrNull(currentKp?.Kp),
                kpScale: currentKp?.noaa_scale || (currentKp ? kpScale(numberOrNull(currentKp.Kp)) : "")
            },
            forecast,
            events: events.slice(0, 12),
            errors
        });
    } catch (error) {
        console.error("Space-weather API handler failed.", error);
        return response.status(500).json({ error: "Unable to process space-weather data." });
    }
};
