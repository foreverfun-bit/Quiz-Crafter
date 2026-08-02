# Escape Room Crafter

A design and organization tool for building physical escape rooms. Track a
portfolio of rooms, each with its own puzzle chain, prop/inventory list,
zone-by-zone layout, and build task board.

All data is saved locally in your browser (`localStorage`) — no account, no
server. Use the **Backup** button in the header to export/import a JSON
snapshot, which is also how you'd move your data to another browser or
device.

## Features

- **Rooms** — a portfolio dashboard of every room you're building, with
  status, difficulty, and progress at a glance.
- **Puzzles & clues** — puzzle type, solution, escalating hints, and
  `depends on` links so you can see how puzzles chain together (and what
  each one unlocks).
- **Props & inventory** — items to source or build, quantity, cost, sourcing
  status, and which puzzle(s) each one belongs to. Running budget total.
- **Room layout & flow** — ordered zones representing the physical path
  players take, with puzzles placed into each zone.
- **Build tasks & timeline** — a To Do / In Progress / Done board with due
  dates, priority, and category, optionally linked to a puzzle or prop.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

### Build for production

```bash
npm run build
npm run preview
```

The `dist/` folder is a static site — deploy it anywhere that serves static
files (Vercel, Netlify, GitHub Pages, etc.).
