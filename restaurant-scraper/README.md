# Digest Rhody

Digest Rhody collects restaurant stories from Rhode Island Monthly, Fork in the Rhode, and The Infatuation. Its responsive page is served by an Express app, which fetches the sources on startup and when **Refresh reviews** is clicked. Each source can fail independently, and up to eight entries are shown per source.

## Run locally

Install Node.js, then open a terminal in this folder and run:

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The refresh button is limited to one scrape every two minutes.

## Deploy to Vercel

1. Push this folder to a GitHub repository. If it is inside a larger repository, set the Vercel project's **Root Directory** to `restaurant-scraper`.
2. Import the repository in Vercel. Leave the framework preset and build settings on automatic detection; Vercel detects the Express app in `server.js`.
3. Deploy. Vercel installs dependencies from `package.json`, serves frontend files from `public/`, and routes API requests to the Express app. No environment variables or custom `vercel.json` are required.

The `public/` directory contains the static homepage assets. Express also serves that directory during local `npm start`, while Vercel serves those files through its CDN. The review refresh API remains in the Express app, so no separate frontend or CORS setup is needed.

Each publisher controls access to its site and may change its page structure or block automated requests. A source that cannot be fetched is reported in its card while the other sources continue to work. Results are held in server memory and may be refreshed after a new Vercel instance starts.
