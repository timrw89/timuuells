# Squeal

Squeal shows up to eight recent reviews from each of four metal review sites. Its responsive page is served by an Express app, which scrapes the sites on startup and when **Refresh reviews** is clicked.

## Run locally

Install Node.js, then open a terminal in this folder and run:

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The refresh button is limited to one scrape every two minutes.

## Deploy to Vercel

1. Push this folder to a GitHub repository. If it is inside a larger repository, set the Vercel project's **Root Directory** to `Scraper_Album_Review`.
2. Import the repository in Vercel. Leave the framework preset and build settings on automatic detection; Vercel detects the Express app in `server.js`.
3. Deploy. Vercel will install dependencies using `package-lock.json`; no environment variables are required.

The project serves both the homepage and its API from the same Express app, so the review refresh button works on the deployed site without a separate frontend or CORS setup.

Each publisher controls access to its site and may change its page structure or block automated requests. A source that cannot be fetched is reported in its card; the other sources continue to work independently. Review results are held in server memory and may be refreshed after a new Vercel instance starts.
