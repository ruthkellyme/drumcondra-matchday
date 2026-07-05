# Drumcondra Match Day Watch 🏟️

Estimates when the roads, resident parking and foot traffic around Croke Park
will actually be affected by a match or gig — built on top of, and clearly
labelled against, the real notices at
[crokepark.ie/communityinfo](https://crokepark.ie/communityinfo).

## What's official vs. estimated

Croke Park publishes: kick-off times, expected attendance, the time parking
restrictions/road closures *start*, which streets/roads are affected, which
roads keep resident-pass access during the closure, and a note that Gardaí may
restrict entry/exit during high pedestrian traffic. Everything else (when
parking is actually maxed out, when foot traffic peaks, when things go back to
normal) is a heuristic estimate scaled by expected attendance — there is no
official tiered system for this. Every segment in the app is labelled
"Croke Park" or "estimate" so it's never ambiguous which is which.

The assumptions (offsets in minutes, attendance tier thresholds) live in
`lib/config.js` — tune them as you see how each match day actually plays out.

Each event card has a "How did this one actually go?" form residents can use
to report corrections — these are appended to `data/feedback.jsonl` (fetch
them at `GET /api/feedback`, no auth). That file is **not persistent on an
ephemeral host** like Render's free tier — it's wiped on every redeploy and
occasionally on restart. Fine for casual use; if it matters, pull the file
periodically or swap in a real database.

## Running it

```
npm install
npm start
```

Then open http://localhost:4173. It auto-fetches the current Croke Park
notice on load and on refresh. If the page's wording changes and the scraper
misses something (it's hand-written prose, not structured data, so this will
happen occasionally), a warning banner appears — check it against
[crokepark.ie/communityinfo](https://crokepark.ie/communityinfo) directly.

`season.html` shows the rest of the year from Croke Park's own
[master fixture list PDF](https://crokepark.ie/BlankSite/media/Images/GAA%20Museum/Croke-Park-Master-Fixture-List-2026.pdf)
— dates and fixture names only, no times or attendance that far out, so it's a
rough heads-up rather than a detailed estimate.

## Deploying

It's a plain Node/Express app with no build step and no database — any
Node host works (set the `PORT` env var if needed). The scraper makes an
outbound request to crokepark.ie on each `/api/events` call, so no API key or
credentials are required.

**Render.com (free tier):**
1. Push this repo to GitHub (already done if you're reading this from there).
2. On [render.com](https://render.com), New → Web Service → connect this repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Leave the free instance type selected — no env vars needed.

The free tier spins down after 15 minutes of inactivity, so the first request
after a quiet spell takes 30-50 seconds to wake back up. Fine for a
low-traffic community tool; upgrade to a paid instance if that's not fine
for your neighbours.

**Using a subdomain of credublinnorth.ie instead of the onrender.com URL:**

credublinnorth.ie is hosted on Netlify (a static-site host), which can't run
this app directly — it needs a persistent Node server, not static files. But
you can still make it feel like part of the same family of sites by pointing
a subdomain at Render instead of moving anything:

1. Deploy this app on Render first and note the `https://<something>.onrender.com`
   URL it gives you.
2. In whatever DNS panel manages credublinnorth.ie's domain (wherever it was
   registered — check your Netlify domain settings if unsure), add a `CNAME`
   record: host `matchday` → value `<something>.onrender.com`.
3. In Render, under the service's Settings → Custom Domains, add
   `matchday.credublinnorth.ie` and follow its verification step.

DNS changes can take anywhere from a few minutes to a few hours to propagate.
Netlify keeps serving the main credublinnorth.ie site untouched throughout —
this only adds a new subdomain, it doesn't move anything.
