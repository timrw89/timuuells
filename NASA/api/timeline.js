async function fetchJson(url, signal) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = payload?.error?.message || payload?.error;
        throw new Error(
            `NASA DONKI returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`
        );
    }
    return payload;
}

function dateChunks(startDate, endDate, chunkDays = 30) {
    const chunks = [];
    let chunkStart = new Date(`${startDate}T00:00:00Z`);
    const finalDate = new Date(`${endDate}T00:00:00Z`);

    while (chunkStart <= finalDate) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
        if (chunkEnd > finalDate) chunkEnd.setTime(finalDate.getTime());
        chunks.push({
            startDate: chunkStart.toISOString().slice(0, 10),
            endDate: chunkEnd.toISOString().slice(0, 10)
        });
        chunkStart = new Date(chunkEnd);
        chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
    }
    return chunks;
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    const apiKey = process.env.nasa_api_key || "DEMO_KEY";
    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const endpoints = [
        { type: "FLR", timeKey: "beginTime" },
        { type: "HSS", timeKey: "eventTime" },
        { type: "GST", timeKey: "startTime" }
    ];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    response.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=43200");

    try {
        const chunks = dateChunks(startDate, endDate);
        const results = [];
        for (const { type, timeKey } of endpoints) {
            for (const chunk of chunks) {
                const url = new URL(`https://api.nasa.gov/DONKI/${type}`);
                url.search = new URLSearchParams({
                    startDate: chunk.startDate,
                    endDate: chunk.endDate,
                    api_key: apiKey
                }).toString();
                const data = await fetchJson(url, controller.signal);
                results.push({ type, timeKey, data: Array.isArray(data) ? data : [] });
            }
        }

        const events = [];
        results.forEach(({ type, timeKey, data }) => {
            if (!Array.isArray(data)) return;
            data.forEach((item) => {
                const rawTime = item[timeKey];
                if (!rawTime) return;
                const timestamp = new Date(rawTime).getTime();
                if (!Number.isFinite(timestamp)) return;

                let intensity = 5;
                let detail = "Solar wind stream";
                if (type === "FLR") {
                    const flareClass = item.classType || "C1.0";
                    const scale = { C: 1.2, M: 3.5, X: 7 }[flareClass[0]] || 1.2;
                    const number = parseFloat(flareClass.slice(1)) || 1;
                    intensity = Math.min(18, scale * Math.sqrt(number));
                    detail = `Class ${flareClass} flare`;
                } else if (type === "GST") {
                    const kpValues = (item.allKpIndex || []).map((entry) => entry.kpIndex || 5);
                    const peakKp = kpValues.length ? Math.max(...kpValues) : 5;
                    intensity = peakKp * 1.8;
                    detail = `Peak Kp-index: ${peakKp}`;
                }

                events.push({
                    timestamp,
                    date: rawTime.slice(0, 10),
                    time: rawTime.includes("T") ? rawTime.slice(11, 16) : "00:00",
                    type,
                    intensity,
                    detail
                });
            });
        });

        events.sort((left, right) => left.timestamp - right.timestamp);
        return response.status(200).json({
            startDate,
            endDate,
            generatedAt: new Date().toISOString(),
            events
        });
    } catch (error) {
        console.error("NASA 365-day timeline request failed.", error);
        return response.status(502).json({
            error: "NASA space-weather timeline is temporarily unavailable.",
            details: [error.name === "AbortError" ? "The NASA request timed out." : error.message]
        });
    } finally {
        clearTimeout(timeout);
    }
};
