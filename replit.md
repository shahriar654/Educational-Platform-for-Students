# NDC Humanities G–L

## Development

- Start the website with `npm run dev` (the server listens on port 5000).
- Configure the environment variables documented in `README.md` and
  `.env.example`. The app uses TiDB Cloud's PostgreSQL-compatible endpoint for
  accounts, note records, and sessions; Cloudinary stores user-uploaded note
  photos.
- Keep backend database queries parameterized. Limit image uploads and check
  their file signatures before sending photos to Cloudinary.
- Browse and search the note library without signing in. Sign-in is required to
  add or remove a student's own note.
- Read `README.md` for the demo account, key files, and instructions for adding
  pages and subjects.

## Database

The app initializes `users`, `notes`, `student_notes`, and `session_store` in
TiDB when they do not already exist. Sample notes are added only when the
`notes` table is empty.
