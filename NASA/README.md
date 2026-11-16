# Earth Space Weather

An Earth-focused space-weather dashboard that reads recent event notifications from NASA DONKI.

## Deploy with Vercel

1. Import the repository as a Vercel project and set **Root Directory** to `NASA`.
2. In **Project Settings → Environment Variables**, add `nasa_api_key` with your NASA API key. Keep it out of HTML, browser JavaScript, and committed files.
3. Deploy. The page calls the same-origin `/api/space-weather` serverless function; the function reads the key and queries NASA's DONKI notifications endpoint.

The dashboard summarizes NASA-reported flares, coronal mass ejections, and geomagnetic storms. NASA DONKI provides event alerts rather than continuous solar-wind measurements or a Kp forecast.

The “Sun in motion” section uses NASA DONKI's newest alert timestamp to request 24 SDO/AIA PNG images from the public [Helioviewer API](https://api.helioviewer.org/docs/v2/), one per hour across the 24 hours ending at that timestamp. The browser animates the images that load successfully. AIA 131 Å is used for flares and AIA 193 Å for other alerts. The timestamp is the alert issue time, which can differ from the actual event time.

The satellite visualization fetches CelesTrak's Kuiper general-perturbations group as OMM JSON through `/api/satellites`, preserving catalog IDs beyond the legacy five-digit TLE limit. The response is cached for three hours; CelesTrak updates GP data every two hours, so avoid repeated downloads. A local Earth SVG provides shaded oceans, continents, and cloud details beneath the orbit paths and satellite markers. The browser estimates positions with simplified Keplerian propagation and compresses orbital distances for display. CelesTrak's GP elements use the SGP4 model, so this visualization is an overview, not a precision tracker or navigation aid.

## Local development

Run these commands from the `NASA` folder so the Vercel CLI can find the serverless route. In PowerShell, set the key in your local shell and start the dev server:

```powershell
$env:nasa_api_key = "your-key"
npx vercel dev
```

Do not commit the key or a populated `.env` file.
