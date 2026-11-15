# Earth Space Weather

An Earth-focused space-weather dashboard that reads live solar-wind and geomagnetic data from NOAA SWPC and recent solar events from NASA DONKI.

## Deploy with Vercel

1. Import the repository as a Vercel project and set **Root Directory** to `NASA`.
2. In **Project Settings → Environment Variables**, add `NASA_API_KEY` with your NASA API key. Keep it out of HTML, browser JavaScript, and committed files.
3. Deploy. The page calls the same-origin `/api/space-weather` serverless function; the function reads the key and queries NASA DONKI.

NOAA conditions and forecast data do not require a key. If `NASA_API_KEY` is not configured, those readings still load, and the recent NASA events section explains that its feed is unavailable.

## Local development

Run the project with the Vercel CLI so the serverless route is available. Set `NASA_API_KEY` in your local shell before starting `vercel dev`; do not commit the key or a populated `.env` file.
