# NDC Humanities G–L

## Development

- Start the website with `npm run dev` (the server listens on port 5000).
- The app uses the Replit-provided PostgreSQL database and expects
  `DATABASE_URL`. It also uses `SESSION_SECRET` to sign student login sessions.
- Keep backend database queries parameterized. User-submitted note images are
  stored in PostgreSQL as binary data; limit image uploads and check their file
  signatures.
- Browse and search the note library without signing in. Sign-in is required to
  add or remove a student's own note.
- Read `README.md` for the demo account, key files, and instructions for adding
  pages and subjects.

## Database

The development database schema is initialized for `users`, `notes`, and
`session_store`; database tables are not created on every server startup.
Replit's Publish flow manages the managed PostgreSQL schema change for a
published deployment.
