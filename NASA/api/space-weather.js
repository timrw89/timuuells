const EVENT_LABELS = {
    CME: "Coronal mass ejection",
    FLR: "Solar flare",
    GST: "Geomagnetic storm",
    IPS: "Interplanetary shock",
    MPC: "Magnetopause crossing",
    RBE: "Radiation belt enhancement",
    SEP: "Solar energetic particles",
    WSAEnlilSimulations: "CME arrival forecast"
};

async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        const detail = payload?.error?.message || payload?.error;
        throw new Error(
            `NASA DONKI returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`
        );
    }

    return payload;
}

function getEventTitle(body, type) {
    const heading = String(body || "").match(/^#{1,6}\s+(.+)$/m);
    return heading ? heading[1].replace(/[*`]/g, "").trim() : EVENT_LABELS[type] || type;
}

function getEventSummary(body) {
    return String(body || "")
        .replace(/\r/g, "")
        .replace(/^#{1,6}\s.*$/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[*_`>#]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320);
}

function getNasaUrl(value) {
    try {
        const url = new URL(value);
        const nasaHost = url.hostname === "nasa.gov" || url.hostname.endsWith(".nasa.gov");
        return url.protocol === "https:" && nasaHost ? url.href : "";
    } catch {
        return "";
    }
}

function getHelioviewerImageUrl(time, type) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const channel = type === "FLR" ? "131" : "193";
    const url = new URL("https://api.helioviewer.org/v2/takeScreenshot/");
    url.search = new URLSearchParams({
        date: date.toISOString(),
        imageScale: "4",
        layers: `[SDO,AIA,AIA,${channel},1,100]`,
        events: "",
        eventLabels: "false",
        x0: "0",
        y0: "0",
        width: "512",
        height: "512",
        display: "true",
        watermark: "true"
    }).toString();
    return url.href;
}

function normalizeNotification(notification) {
    const type = notification.messageType || "NASA notification";
    const time = notification.messageIssueTime || "";

    return {
        type: EVENT_LABELS[type] || type,
        title: getEventTitle(notification.messageBody, type),
        time,
        summary: getEventSummary(notification.messageBody),
        url: getNasaUrl(notification.messageURL),
        imageUrl: getHelioviewerImageUrl(time, type),
        imageChannel: type === "FLR" ? "131" : "193"
    };
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

    const apiKey = process.env.nasa_api_key;
    if (!apiKey) {
        return response.status(503).json({
            error: "NASA API key is not configured.",
            details: ["Set nasa_api_key in the Vercel environment and redeploy."]
        });
    }

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const url = new URL("https://api.nasa.gov/DONKI/notifications");
    url.search = new URLSearchParams({
        startDate,
        endDate,
        api_key: apiKey
    }).toString();

    try {
        const notifications = await fetchJson(url);
        if (!Array.isArray(notifications)) {
            throw new Error("NASA DONKI returned data in an unsupported format.");
        }

        const sortedNotifications = notifications.slice().sort(
            (left, right) =>
                new Date(right.messageIssueTime) - new Date(left.messageIssueTime)
        );
        const events = sortedNotifications.slice(0, 12).map(normalizeNotification);
        const types = notifications.map((notification) => notification.messageType);

        return response.status(200).json({
            generatedAt: new Date().toISOString(),
            windowStart: startDate,
            windowEnd: endDate,
            counts: {
                flares: types.filter((type) => type === "FLR").length,
                cmes: types.filter((type) => type === "CME" || type === "WSAEnlilSimulations").length,
                storms: types.filter((type) => type === "GST").length,
                total: notifications.length
            },
            events
        });
    } catch (error) {
        console.error("NASA DONKI request failed.", error);
        return response.status(502).json({
            error: "NASA DONKI data is temporarily unavailable.",
            details: [error.message]
        });
    }
};
