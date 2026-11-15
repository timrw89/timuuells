const FRAME_INTERVAL_MS = 60 * 60 * 1000;
const FRAME_COUNT = 24;

function badRequest(message) {
    return Object.assign(new Error(message), { statusCode: 400 });
}

function createImageUrl(time, channel) {
    const url = new URL("https://api.helioviewer.org/v2/takeScreenshot/");
    url.search = new URLSearchParams({
        date: time,
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

module.exports = async function handler(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "no-store");

    try {
        const body = request.body && typeof request.body === "object" ? request.body : {};
        if (typeof body.time !== "string" || typeof body.type !== "string") {
            throw badRequest("A NASA alert timestamp and type are required.");
        }

        const alertTime = new Date(body.time);
        if (Number.isNaN(alertTime.getTime())) {
            throw badRequest("The NASA alert timestamp is invalid.");
        }

        if (!/^[A-Za-z0-9_-]{1,40}$/.test(body.type)) {
            throw badRequest("The NASA alert type is invalid.");
        }

        const age = Date.now() - alertTime.getTime();
        if (age > 8 * 24 * 60 * 60 * 1000 || age < -5 * 60 * 1000) {
            throw badRequest("The NASA alert timestamp is outside the available 7-day window.");
        }

        const channel = body.type === "FLR" ? "131" : "193";
        const endTime = alertTime.toISOString();
        const startMilliseconds = alertTime.getTime() - (FRAME_COUNT - 1) * FRAME_INTERVAL_MS;
        const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
            const time = new Date(startMilliseconds + index * FRAME_INTERVAL_MS).toISOString();
            return { time, url: createImageUrl(time, channel) };
        });

        return response.status(200).json({
            alertTime: endTime,
            startTime: frames[0].time,
            endTime,
            channel,
            frames
        });
    } catch (error) {
        if (error.statusCode !== 400) {
            console.error("Unable to create Helioviewer frame URLs.", error);
        }
        return response.status(error.statusCode || 500).json({ error: error.message });
    }
};
