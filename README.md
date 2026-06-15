# ohnoban

A personal kanban board that runs entirely in the browser. No backend, no build step, no framework -- just HTML, CSS, and a little JavaScript.

## Features

- **Drag and drop** cards between columns and reorder within columns
- **Notes** -- a separate tab for standalone notes (title, tags, markdown body) that don't live on the board
- **Markdown descriptions** with bold, italic, links, lists, and code blocks
- **Color-coded tags** with auto-contrasting text (light/dark) via CSS `oklch`
- **Card dialog** with view and edit modes
- **Tag management** -- create, rename, recolor, and delete tags from board settings
- **Column management** -- add, delete, and reorder columns
- **localStorage persistence** -- all changes auto-save and survive page reloads
- **JSON import/export** -- download your board as a JSON file or restore from one

## Getting started

Serve the directory with any static file server:

```
cd ohnoban
python3 -m http.server 8000
```

Open `http://localhost:8000`. The board seeds from `board.json` on first load, then persists to localStorage.

## Files

```
index.html       -- markup
app.js           -- application logic
style.css        -- styles
board.json       -- seed data (used on first load only)
marked.min.js    -- vendored markdown parser (marked v18.0.2)
```

## Data format

The board is stored as JSON, both in localStorage and in exported files:

```json
{
  "title": "My Board",
  "tags": {
    "bug": "#c23030",
    "feature": "#2b4f8e"
  },
  "columns": [
    {
      "id": "backlog",
      "title": "Backlog",
      "cards": [
        {
          "title": "Card title",
          "description": "Markdown **description**",
          "tags": ["bug"]
        }
      ]
    }
  ],
  "notes": [
    {
      "title": "Note title",
      "description": "Markdown **body**",
      "tags": ["feature"]
    }
  ]
}
```

To reset the board to its initial state, clear localStorage (`localStorage.removeItem("ohnoban-board")` in the console) and reload.
