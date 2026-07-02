# Notes backups

Daily snapshots of the shared JSONBin notes/tags store (`src/App.jsx`'s
`NOTES_BIN`), written by `.github/workflows/backup-notes.yml`. One file
per day: `notes-YYYY-MM-DD.json`. Nothing here is ever deleted or
overwritten by the workflow, so this is a restorable history even if the
bin itself gets cleared.

To restore, PUT the contents of the desired `notes-*.json` file back to
`https://api.jsonbin.io/v3/b/<NOTES_BIN>` with the `X-Access-Key` header
(same credentials used in `src/App.jsx`).
