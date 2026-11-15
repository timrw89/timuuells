async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        const detail = payload?.error?.message || payload?.error;
        throw new Error(
            `Helioviewer returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`
        );
    }

    return payload;
}

function isHelioviewerUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            (url.hostname === "helioviewer.org" || url.hostname.endsWith(".helioviewer.org"));
    } catch {
        return false;
    }
}

function readBody(request) {
    if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
        return request.body;
    }

    if (typeof request.body === "string") {
        try {
            const body = JSON.parse(request.body);
            return body && typeof body === "object" && !Array.isArray(body) ? body : {};
        } catch {
            return {};
        }
    }

    return {};
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

async function queueMovie(time, type) {
    if (typeof time !== "string") {
        throw badRequest("The NASA alert timestamp is invalid.");
    }

    const eventTime = new Date(time);
    if (Number.isNaN(eventTime.getTime())) {
        throw badRequest("The NASA alert timestamp is invalid.");
    }

    const age = Date.now() - eventTime.getTime();
    if (age > 8 * 24 * 60 * 60 * 1000 || age < -5 * 60 * 1000) {
        throw badRequest("The NASA alert timestamp is outside the available 7-day window.");
    }

    if (typeof type !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(type)) {
        throw badRequest("The NASA alert type is invalid.");
    }

    const channel = type === "FLR" ? "131" : "193";
    const startTime = new Date(eventTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const url = new URL("https://api.helioviewer.org/v2/queueMovie/");
    url.search = new URLSearchParams({
        startTime,
        endTime: eventTime.toISOString(),
        layers: `[SDO,AIA,AIA,${channel},1,100]`,
        events: "",
        eventsLabels: "false",
        imageScale: "4",
        cadence: "1800",
        frameRate: "8",
        movieLength: "6",
        format: "mp4",
        size: "1",
        watermark: "true"
    }).toString();

    const job = await fetchJson(url);
    if (
        typeof job.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,32}$/.test(job.id) ||
        typeof job.token !== "string" ||
        !/^[a-f0-9]{32,64}$/i.test(job.token)
    ) {
        throw new Error("Helioviewer returned an invalid movie job.");
    }

    return {
        id: job.id,
        token: job.token,
        eta: Number.isFinite(Number(job.eta)) ? Number(job.eta) : null,
        channel,
        alertTime: eventTime.toISOString()
    };
}

async function getMovieStatus(id, token) {
    if (
        typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
        typeof token !== "string" ||
        !/^[a-f0-9]{32,64}$/i.test(token)
    ) {
        throw badRequest("The Helioviewer movie job is invalid.");
    }

    const url = new URL("https://api.helioviewer.org/v2/getMovieStatus/");
    url.search = new URLSearchParams({
        id,
        format: "mp4",
        verbose: "true",
        token
    }).toString();
    const movie = await fetchJson(url);

    if (movie.status === 2) {
        if (!isHelioviewerUrl(movie.url) || !isHelioviewerUrl(movie.thumbnails?.medium)) {
            throw new Error("Helioviewer returned an invalid movie link.");
        }

        return {
            status: "ready",
            videoUrl: movie.url,
            posterUrl: movie.thumbnails.medium,
            title: movie.title || "SDO solar activity",
            startDate: movie.startDate || "",
            endDate: movie.endDate || "",
            duration: Number.isFinite(Number(movie.duration)) ? Number(movie.duration) : null
        };
    }

    if (movie.status === 0 || movie.status === 1) {
        return {
            status: movie.status === 0 ? "queued" : "processing",
            statusLabel: movie.statusLabel || "Rendering solar animation"
        };
    }

    throw new Error(movie.statusLabel || "Helioviewer could not render the solar animation.");
}

module.exports = async function handler(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "no-store");
    const body = readBody(request);

    try {
        const result = body.id
            ? await getMovieStatus(body.id, body.token)
            : await queueMovie(body.time, body.type);
        const statusCode = result.status === "ready" ? 200 : 202;
        return response.status(statusCode).json(result);
    } catch (error) {
        console.error("Helioviewer solar animation request failed.", error);
        return response.status(error.statusCode || 502).json({
            error: "Unable to prepare the solar animation.",
            details: [error.message]
        });
    }
};
