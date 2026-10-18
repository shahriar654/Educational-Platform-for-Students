# NDC Humanities G–L

A shared class-notes library for NDC Humanities Group G–L. Students can browse
class notes by day, subject, and keyword; create an account; and share a photo
of their notes with classmates.

The app runs as one Node.js web server and uses:

- **TiDB Cloud's PostgreSQL-compatible endpoint** for accounts, note records,
  and login sessions.
- **Cloudinary** for user-uploaded note photos.

## Configure environment variables

Copy `.env.example` to `.env`, then fill in the values:

```sh
cp .env.example .env
```

Required values:

```sh
SESSION_SECRET=replace-with-a-long-random-string

TIDB_HOST=your-tidb-cluster-host
TIDB_PORT=5432
TIDB_USER=your-tidb-user
TIDB_PASSWORD=your-tidb-password
TIDB_DATABASE=your-database-name

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Set `TIDB_CA_CERT` only when your TiDB cluster requires a specific CA
certificate. The app otherwise connects to TiDB with TLS.

For Replit, add the same names and values in **Secrets** instead of creating a
`.env` file.

## Run the app

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

The app serves on port `5000` unless `PORT` is set. On startup, it creates the
`users`, `notes`, `student_notes`, and `session_store` tables when they do not
already exist.

## Deploy on Vercel

The `public/` directory is served as static frontend files, and
`api/[...slug].js` exposes the Express `/api` routes as a Vercel serverless
function. No build step is required.

1. Import the GitHub repository into Vercel.
2. Add the environment variables from `.env.example` in **Project Settings →
   Environment Variables**.
3. Deploy.

For production, always set a long random `SESSION_SECRET`. Use the TiDB Cloud
PostgreSQL-compatible credentials (host ending in `pg.tidbcloud.com`, port
`5432`, user, password, and database) and valid Cloudinary credentials. TiDB
must be reachable over TLS.

## Try the sample data

The database is seeded with 14 sample notes: one for every subject today and one
for every subject the day before. Sample photos are generated note-page images.
The sample records are added only when the notes table is empty.

Use this demo account to try posting and removing a note:

- Email: `demo@ndcgl.edu.bd`
- Password: `NdcStudent2026!`

Notes are public to browse. Signing in is required to post a note or remove
one of your own. A student may share one note per subject per class day. Photo
uploads accept JPG, PNG, and WebP files up to 8 MB and are stored in the
`ndc-humanities-gl` Cloudinary folder with automatic format and quality.

## Project map

- `server.js` — Express routes, TiDB queries, sign-in, Cloudinary photo handling, and sample data.
- `public/index.html` — Homepage, note library, upload form, and account dialogs.
- `public/app.js` — Search, date/subject filters, login/signup, upload, and photo viewer interactions.
- `public/styles.css` — Responsive layout, colors, typography, and component styling.
- `.env.example` — Documented environment variables for TiDB, Cloudinary, and the app.

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
  review the `subject` columns in the TiDB tables, and add its color in
  `public/styles.css`.
- Schema changes are initialized in `server.js`. For an existing TiDB database,
  apply the corresponding `ALTER TABLE` statements before deploying the app.
