# Space Weather

An Earth-focused space-weather dashboard for live aurora and solar-wind conditions, recent NASA event reports, solar imagery, and CelesTrak's last-30-days satellite group.

## Deploy with Vercel

1. Import the repository as a Vercel project and set **Root Directory** to `NASA`.
2. In **Project Settings → Environment Variables**, add `nasa_api_key` with your NASA API key. Keep it out of HTML, browser JavaScript, and committed files.
3. Deploy. The page calls same-origin serverless endpoints for NOAA SWPC conditions, NASA DONKI notifications, solar imagery, and CelesTrak orbital elements.

The first section combines NOAA SWPC's OVATION aurora forecast and solar-wind magnetic-field feed with NASA DONKI's latest flare. NOAA data is fetched by `/api/earth-conditions` and cached for five minutes; if either NOAA feed fails, the page displays the other feed and a visible partial-data warning. The forecast points are drawn over a local Earth illustration and are not a live photograph.

The NASA DONKI section summarizes notifications from the past seven days and lists recent reports. Its “Sun in motion” subsection uses the newest alert timestamp to request 24 SDO/AIA PNG images from the public [Helioviewer API](https://api.helioviewer.org/docs/v2/), one per hour across the 24 hours ending at that timestamp. The browser animates the images that load successfully. AIA 131 Å is used for flares and AIA 193 Å for other alerts. The timestamp is the alert issue time, which can differ from the actual event time.

The satellite section fetches CelesTrak's `last-30-days` general-perturbations group as OMM JSON through `/api/satellites`, preserving catalog IDs beyond the legacy five-digit TLE limit. The response is cached for three hours; CelesTrak updates GP data every two hours, so avoid repeated downloads and surface upstream failures rather than retrying automatically. A local Earth SVG provides shaded oceans, continents, and cloud details beneath the satellite markers. The browser estimates positions with simplified Keplerian propagation and compresses orbital distances for display. CelesTrak's GP elements use the SGP4 model, so this visualization is an overview, not a precision tracker or navigation aid.

## Local development

Run these commands from the `NASA` folder so the Vercel CLI can find the serverless route. In PowerShell, set the key in your local shell and start the dev server:

```powershell
$env:nasa_api_key = "your-key"
npx vercel dev
```

Do not commit the key or a populated `.env` file.
