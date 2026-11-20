const HELIOVIEWER_URL = "https://api.helioviewer.org/v2/getClosestImage/";
const AIA_131_SOURCE_ID = 9;

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    const date = typeof request.query?.date === "string" ? request.query.date : "";
    if (
        date.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date) ||
        !Number.isFinite(Date.parse(date))
    ) {
        return response.status(400).json({ error: "A valid ISO 8601 date and time is required." });
    }

    response.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const url = new URL(HELIOVIEWER_URL);
        url.searchParams.set("date", date);
        url.searchParams.set("sourceId", String(AIA_131_SOURCE_ID));
        const upstream = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: controller.signal
        });
        if (!upstream.ok) {
            throw new Error(`Helioviewer returned HTTP ${upstream.status}.`);
        }

        const image = await upstream.json();
        if (!image || !/^\d+$/.test(String(image.id || ""))) {
            throw new Error("Helioviewer returned no image for that time.");
        }

        const imageUrl = new URL("https://api.helioviewer.org/v2/downloadImage/");
        imageUrl.searchParams.set("id", String(image.id));
        imageUrl.searchParams.set("width", "900");
        imageUrl.searchParams.set("type", "jpg");

        return response.status(200).json({
            requestedAt: new Date(date).toISOString(),
            imageAt: image.date,
            imageName: image.name || "SDO AIA 131",
            imageUrl: imageUrl.toString(),
            attributionUrl: "https://helioviewer.org/"
        });
    } catch (error) {
        console.error("Helioviewer flare image request failed.", error);
        return response.status(502).json({
            error: "The Helioviewer solar image is temporarily unavailable.",
            details: [error.name === "AbortError" ? "The Helioviewer request timed out." : error.message]
        });
    } finally {
        clearTimeout(timeout);
    }
};
