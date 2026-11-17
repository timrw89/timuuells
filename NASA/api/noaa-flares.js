const GOES_XRAY_URL =
    "https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json";
const FLARE_THRESHOLD = 1e-6;
const FLARE_END_THRESHOLD = 6e-7;
const FLARE_GAP_MS = 10 * 60 * 1000;

async function fetchJson(url, signal) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal
    });
    if (!response.ok) {
        throw new Error(`NOAA SWPC returned HTTP ${response.status}.`);
    }
    return response.json();
}

function flareClass(flux) {
    if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
    if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
    return `C${(flux / 1e-6).toFixed(1)}`;
}

function extractFlares(rows) {
    if (!Array.isArray(rows)) {
        throw new Error("NOAA SWPC returned an unsupported GOES X-ray feed.");
    }

    const samplesByTime = new Map();
    for (const row of rows) {
        if (!/0\.1\s*-\s*0\.8/i.test(String(row.energy || ""))) continue;
        const timestamp = Date.parse(row.time_tag);
        const flux = Number(row.flux);
        if (!Number.isFinite(timestamp) || !Number.isFinite(flux) || flux <= 0) continue;

        const previous = samplesByTime.get(timestamp);
        if (!previous || flux > previous.flux) {
            samplesByTime.set(timestamp, { timestamp, flux });
        }
    }

    const samples = [...samplesByTime.values()].sort(
        (left, right) => left.timestamp - right.timestamp
    );
    const flares = [];
    let activeFlare = null;

    function finishFlare() {
        if (!activeFlare) return;
        const date = new Date(activeFlare.peak.timestamp);
        const flareType = flareClass(activeFlare.peak.flux);
        const classScale = { C: 1.2, M: 3.5, X: 7 }[flareType[0]];
        const classValue = Number.parseFloat(flareType.slice(1));
        flares.push({
            timestamp: activeFlare.peak.timestamp,
            date: date.toISOString().slice(0, 10),
            time: date.toISOString().slice(11, 16),
            type: "FLR",
            intensity: Math.min(18, classScale * Math.sqrt(classValue)),
            detail: `${flareType} flare peak · ${activeFlare.peak.flux.toExponential(2)} W/m²`
        });
        activeFlare = null;
    }

    for (const sample of samples) {
        if (
            activeFlare &&
            sample.timestamp - activeFlare.lastSample > FLARE_GAP_MS
        ) {
            finishFlare();
        }

        if (sample.flux >= FLARE_THRESHOLD) {
            if (
                activeFlare?.belowThresholdSince &&
                sample.timestamp - activeFlare.belowThresholdSince >= FLARE_GAP_MS
            ) {
                finishFlare();
            }
            if (!activeFlare) {
                activeFlare = { peak: sample, lastSample: sample.timestamp };
            } else {
                activeFlare.lastSample = sample.timestamp;
                if (sample.flux > activeFlare.peak.flux) activeFlare.peak = sample;
                activeFlare.belowThresholdSince = null;
            }
        } else if (activeFlare) {
            activeFlare.lastSample = sample.timestamp;
            if (sample.flux < FLARE_END_THRESHOLD) {
                const belowThresholdSince = activeFlare.belowThresholdSince || sample.timestamp;
                activeFlare.belowThresholdSince = belowThresholdSince;
                if (sample.timestamp - belowThresholdSince >= FLARE_GAP_MS) finishFlare();
            } else {
                activeFlare.belowThresholdSince = null;
            }
        }
    }
    finishFlare();

    return {
        samples,
        events: flares,
        startDate: samples.length ? new Date(samples[0].timestamp).toISOString().slice(0, 10) : "",
        endDate: samples.length ? new Date(samples[samples.length - 1].timestamp).toISOString().slice(0, 10) : ""
    };
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const data = extractFlares(await fetchJson(GOES_XRAY_URL, controller.signal));
        if (data.samples.length === 0) {
            throw new Error("NOAA SWPC returned no usable 0.1–0.8 nm X-ray samples.");
        }
        return response.status(200).json({
            generatedAt: new Date().toISOString(),
            startDate: data.startDate,
            endDate: data.endDate,
            sampleCount: data.samples.length,
            eventCount: data.events.length,
            emptyMessage: "No C-class or stronger flare intervals were detected in the available GOES samples.",
            events: data.events
        });
    } catch (error) {
        console.error("NOAA SWPC GOES flare timeline request failed.", error);
        return response.status(502).json({
            error: "NOAA SWPC GOES flare data is temporarily unavailable.",
            details: [error.name === "AbortError" ? "The NOAA SWPC request timed out." : error.message]
        });
    } finally {
        clearTimeout(timeout);
    }
};
