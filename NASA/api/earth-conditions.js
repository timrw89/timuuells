const AURORA_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
const MAGNETIC_FIELD_URL = "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json";

async function fetchJson(url, signal, source) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal
    });

    if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 300);
        throw new Error(
            `${source} returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`
        );
    }

    return response.json();
}

function normalizeAurora(data) {
    const coordinates = data && (data.coordinates || data.Data);
    if (!Array.isArray(coordinates)) {
        throw new Error("NOAA SWPC returned an unsupported aurora forecast.");
    }

    let peakProbability = 0;
    let validPointCount = 0;
    const points = [];
    for (const point of coordinates) {
        if (
            !Array.isArray(point) ||
            point.length < 3 ||
            !point.slice(0, 3).every(Number.isFinite)
        ) {
            continue;
        }

        const [longitude, latitude, probability] = point;
        validPointCount += 1;
        peakProbability = Math.max(peakProbability, probability);
        if (Math.abs(latitude) >= 45 && probability >= 5) {
            points.push([longitude, latitude, probability]);
        }
    }

    if (validPointCount === 0) {
        throw new Error("NOAA SWPC returned no usable aurora forecast points.");
    }

    return {
        forecastTime: data["Forecast Time"] || "",
        observationTime: data["Observation Time"] || "",
        peakProbability,
        points
    };
}

function normalizeMagneticField(rows) {
    if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0])) {
        throw new Error("NOAA SWPC returned an unsupported magnetic-field series.");
    }

    const columns = rows[0].map((column) => String(column).toLowerCase());
    const timeIndex = columns.indexOf("time_tag");
    const bzIndex = columns.indexOf("bz_gsm");
    const btIndex = columns.indexOf("bt");
    if (timeIndex < 0 || bzIndex < 0 || btIndex < 0) {
        throw new Error("NOAA SWPC magnetic-field columns were not recognized.");
    }

    for (let index = rows.length - 1; index > 0; index -= 1) {
        const row = rows[index];
        const bz = Number.parseFloat(row[bzIndex]);
        const bt = Number.parseFloat(row[btIndex]);
        if (Number.isFinite(bz) && Number.isFinite(bt)) {
            return { time: row[timeIndex], bz, bt };
        }
    }

    throw new Error("NOAA SWPC returned no recent magnetic-field measurements.");
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const [auroraResult, magneticResult] = await Promise.allSettled([
            fetchJson(AURORA_URL, controller.signal, "NOAA SWPC aurora forecast")
                .then(normalizeAurora),
            fetchJson(MAGNETIC_FIELD_URL, controller.signal, "NOAA SWPC magnetic-field feed")
                .then(normalizeMagneticField)
        ]);
        const errors = {};
        const aurora = auroraResult.status === "fulfilled" ? auroraResult.value : null;
        const magneticField = magneticResult.status === "fulfilled" ? magneticResult.value : null;

        if (auroraResult.status === "rejected") {
            errors.aurora = auroraResult.reason instanceof Error
                ? auroraResult.reason.message
                : String(auroraResult.reason);
        }
        if (magneticResult.status === "rejected") {
            errors.magneticField = magneticResult.reason instanceof Error
                ? magneticResult.reason.message
                : String(magneticResult.reason);
        }
        if (!aurora && !magneticField) {
            throw new Error(Object.values(errors).join(" "));
        }

        return response.status(200).json({
            generatedAt: new Date().toISOString(),
            aurora,
            magneticField,
            errors
        });
    } catch (error) {
        console.error("NOAA SWPC live conditions request failed.", error);
        return response.status(502).json({
            error: "Live aurora and magnetic-field data are temporarily unavailable.",
            details: [error.name === "AbortError" ? "The NOAA SWPC request timed out." : error.message]
        });
    } finally {
        clearTimeout(timeout);
    }
};
