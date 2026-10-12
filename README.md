# NDC Humanities G–L

A shared class-notes library for NDC Humanities Group G–L. Students can browse
class notes by day, subject, and keyword; create an account; and share a photo
of their notes with classmates.

## Run on Replit

The app runs as one Node.js web server:

```sh
npm run dev
```

Replit's PostgreSQL database stores accounts, note details, note photos, and
login sessions. The app serves on port 5000. Set `SESSION_SECRET` in Replit
Secrets for stable, secure login sessions; Replit can pass the existing secret
through to the app.

## Try the sample data

The database is seeded with 14 sample notes: one for every subject today and one
for every subject the day before. Sample photos are generated note-page images.
The sample records are added only when the notes table is empty.

Use this demo account to try posting and removing a note:

- Email: `demo@ndcgl.edu.bd`
- Password: `NdcStudent2026!`

Notes are public to browse. Signing in is required to post a note or remove
one of your own. A student may share one note per subject per class day. Photo
uploads accept JPG, PNG, and WebP files up to 8 MB.

## Project map

- `server.js` — Express routes, PostgreSQL queries, sign-in, photo handling, and sample data.
- `public/index.html` — Homepage, note library, upload form, and account dialogs.
- `public/app.js` — Search, date/subject filters, login/signup, upload, and photo viewer interactions.
- `public/styles.css` — Responsive layout, colors, typography, and component styling.

## Modify and add pages

- Adjust the colors, spacing, and mobile layouts in `public/styles.css`.
- Change the landing page, form fields, or page sections in `public/index.html`;
  connect new buttons and behavior in `public/app.js`.
- Update account, upload, and search behavior in the `/api/...` handlers in
  `server.js`. Validate inputs on the server as well as in browser forms.
- Add a new page as another HTML file in `public/` (for example,
  `public/about.html`) and link it from the homepage. Express serves files in
  this folder automatically.
- To add a subject, update the subject list in `server.js` and `public/app.js`,
  update the PostgreSQL subject check constraint, and add its color in
  `public/styles.css`.
- Database table definitions are maintained in the Replit development
  PostgreSQL database. When changing the schema for a published app, review the
  schema diff in Replit's Publish flow.

The development workflow is configured to start `npm run dev` on port 5000.