# Space Weather

An Earth and space-weather dashboard for NASA EPIC imagery, recent NASA event reports, solar imagery, and CelesTrak's last-30-days satellite group.

## Deploy with Vercel

1. Import the repository as a Vercel project and set **Root Directory** to `NASA`.
2. In **Project Settings → Environment Variables**, add `nasa_api_key` or `NASA_API_KEY` with your NASA API key. Keep it out of HTML, browser JavaScript, and committed files.
3. Deploy. The page calls same-origin serverless endpoints for NASA EPIC imagery, NASA DONKI notifications, solar imagery, and CelesTrak orbital elements.

The Earth section fetches one natural-color EPIC image for each of the latest seven available days through `/api/epic`. The images play as an animated carousel and can be paused or stepped manually.

The NOAA SWPC GOES timeline fetches the latest seven days of primary GOES 0.1–0.8 nm X-ray flux through `/api/noaa-flares`. It derives C-class and stronger flare intervals from the flux samples, with marker color by C/M/X class and marker size scaled by peak flux. It also provides animation, playback controls, a scrubber, and speed selection. The separate space-weather timeline retrieves FLR, HSS, and GST events for the past 365 days through `/api/timeline`. FLR uses the migrated CCMC DONKI endpoint; HSS and GST use NASA's API, with requests split into 30-day chunks.

The satellite section fetches CelesTrak's `last-30-days` general-perturbations group as OMM JSON through `/api/satellites`, preserving catalog IDs beyond the legacy five-digit TLE limit. The response is cached for three hours; CelesTrak updates GP data every two hours, so avoid repeated downloads and surface upstream failures rather than retrying automatically. A local Earth SVG provides shaded oceans, continents, and cloud details beneath the satellite markers. The browser estimates positions with simplified Keplerian propagation and compresses orbital distances for display. CelesTrak's GP elements use the SGP4 model, so this visualization is an overview, not a precision tracker or navigation aid.

## Local development

Run these commands from the `NASA` folder so the Vercel CLI can find the serverless route. In PowerShell, set the key in your local shell and start the dev server:

```powershell
$env:nasa_api_key = "your-key"
npx vercel dev
```

Do not commit the key or a populated `.env` file.
