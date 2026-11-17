async function fetchJson(url, signal) {
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal
    });
    if (!response.ok) {
        throw new Error(`NASA EPIC returned HTTP ${response.status}.`);
    }
    return response.json();
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    const apiKey = process.env.nasa_api_key || "DEMO_KEY";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    response.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");

    try {
        const availableUrl = new URL("https://api.nasa.gov/EPIC/api/natural/available");
        availableUrl.searchParams.set("api_key", apiKey);
        const availableDates = await fetchJson(availableUrl, controller.signal);
        if (!Array.isArray(availableDates) || availableDates.length === 0) {
            throw new Error("NASA EPIC returned no available dates.");
        }

        const recentDates = availableDates
            .slice()
            .sort((left, right) => right.localeCompare(left))
            .slice(0, 7);
        const imageSets = await Promise.all(recentDates.map(async (date) => {
            const dateUrl = new URL(`https://api.nasa.gov/EPIC/api/natural/date/${date}`);
            dateUrl.searchParams.set("api_key", apiKey);
            const entries = await fetchJson(dateUrl, controller.signal);
            if (!Array.isArray(entries) || entries.length === 0) {
                return null;
            }

            const entry = entries[0];
            const [year, month, day] = date.split("-");
            return {
                identifier: entry.identifier,
                caption: entry.caption || "Earth from the DSCOVR EPIC camera",
                date: entry.date || `${date} 00:00:00`,
                image: `https://epic.gsfc.nasa.gov/archive/natural/${year}/${month}/${day}/png/${entry.image}.png`
            };
        }));

        const images = imageSets.filter(Boolean);
        if (images.length === 0) {
            throw new Error("NASA EPIC returned no usable images.");
        }

        return response.status(200).json({
            generatedAt: new Date().toISOString(),
            images
        });
    } catch (error) {
        console.error("NASA EPIC request failed.", error);
        return response.status(502).json({
            error: "NASA EPIC Earth images are temporarily unavailable.",
            details: [error.name === "AbortError" ? "The NASA EPIC request timed out." : error.message]
        });
    } finally {
        clearTimeout(timeout);
    }
};
