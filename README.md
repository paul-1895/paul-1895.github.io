# DSE tracker — published snapshot

A read-only snapshot of a personal Dhaka Stock Exchange tracker.

- **Prices refresh on a schedule.** `.github/workflows/refresh-prices.yml`
  re-scrapes dsebd.org after each trading day's close and commits
  `api/stocks.json`. Everything else changes only when the site is rebuilt.
- **Nothing here can be edited.** There is no server and no database. Every
  write control is hidden, and any write request is refused in the browser.
- **This is not investment advice**, and the data carries no warranty. Prices
  are a snapshot, not a live feed.

Built 2026-08-28 from a private source repository.
