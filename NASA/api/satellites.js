const CELESTRAK_URL =
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=kuiper&FORMAT=json";

function parseEpoch(value) {
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    return new Date(hasTimezone ? value : `${value}Z`);
}

function isValidSatellite(satellite) {
    return satellite &&
        typeof satellite.EPOCH === "string" &&
        Number.isFinite(parseEpoch(satellite.EPOCH).getTime()) &&
        Number.isFinite(satellite.MEAN_MOTION) &&
        satellite.MEAN_MOTION > 0 &&
        Number.isFinite(satellite.ECCENTRICITY) &&
        satellite.ECCENTRICITY >= 0 &&
        satellite.ECCENTRICITY < 1 &&
        Number.isFinite(satellite.INCLINATION) &&
        Number.isFinite(satellite.RA_OF_ASC_NODE) &&
        Number.isFinite(satellite.ARG_OF_PERICENTER) &&
        Number.isFinite(satellite.MEAN_ANOMALY);
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed." });
    }

    response.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=86400");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const upstream = await fetch(CELESTRAK_URL, {
            headers: { Accept: "application/json" },
            signal: controller.signal
        });
        if (!upstream.ok) {
            const upstreamMessage = (await upstream.text()).trim().slice(0, 500);
            const error = new Error(
                `CelesTrak returned HTTP ${upstream.status}.` +
                (upstreamMessage ? ` ${upstreamMessage}` : "")
            );
            error.upstreamStatus = upstream.status;
            error.retryAfter = upstream.headers.get("Retry-After");
            throw error;
        }

        const satellites = await upstream.json();
        if (!Array.isArray(satellites)) {
            throw new Error("CelesTrak returned data in an unsupported format.");
        }

        const elements = satellites.filter(isValidSatellite).map((satellite) => {
            const catalogId = satellite.NORAD_CAT_ID == null
                ? ""
                : String(satellite.NORAD_CAT_ID);
            const name = typeof satellite.OBJECT_NAME === "string" &&
                satellite.OBJECT_NAME.trim()
                ? satellite.OBJECT_NAME.trim()
                : catalogId
                    ? `Catalog object ${catalogId}`
                    : "Unidentified active object";

            return {
                name,
                catalogId,
                epoch: parseEpoch(satellite.EPOCH).toISOString(),
                meanMotion: satellite.MEAN_MOTION,
                eccentricity: satellite.ECCENTRICITY,
                inclination: satellite.INCLINATION,
                ascendingNode: satellite.RA_OF_ASC_NODE,
                argumentOfPerigee: satellite.ARG_OF_PERICENTER,
                meanAnomaly: satellite.MEAN_ANOMALY
            };
        });

        if (elements.length === 0) {
            throw new Error("CelesTrak did not return valid Kuiper orbital elements.");
        }

        return response.status(200).json({
            generatedAt: new Date().toISOString(),
            satellites: elements
        });
    } catch (error) {
        console.error("CelesTrak satellite data request failed.", error);
        if (error.retryAfter) {
            response.setHeader("Retry-After", error.retryAfter);
        }
        return response.status(502).json({
            error: "Kuiper satellite data is temporarily unavailable.",
            upstreamStatus: error.upstreamStatus || null,
            details: [error.name === "AbortError" ? "The CelesTrak request timed out." : error.message]
        });
    } finally {
        clearTimeout(timeout);
    }
};
