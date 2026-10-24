# NDC Humanities G–L

**A shared digital notebook for classmates.**

NDC Humanities G–L is a web application where students can browse class notes by
date, subject, and keyword, then contribute their own photographed notebook
pages for the group to study from.

---

## Presentation overview

### The problem

Class notes are often spread across notebooks, phones, and private messages.
When a student misses a class or wants to revise, finding a complete and clear
set of notes can take longer than the studying itself.

### The solution

This project creates one shared study library for the class:

- Every student can browse notes without creating an account.
- Only class captains can publish a note for a subject and class date, so the
  library stays clean and storage doesn't fill up with duplicates.
- One note can contain up to eight photos, so a lesson can include multiple
  pages.
- Captains can remove their own notes; the site owner can remove any note or
  any single photo.
- Sample notes make the library useful immediately after setup.

### Target users

- Students in NDC Humanities Group G–L.
- Classmates who missed a lecture and need a reliable note source.
- Students who want one organized archive for revision.

---

## Core features

| Area | What the app does |
| --- | --- |
| Browse | Shows class notes by day, subject, and keyword. |
| Upload | Captains upload up to 8 JPG, PNG, or WebP photos per note; photos are resized in the browser first. |
| Accounts | No public sign-up. The owner creates captain accounts; students read without an account. |
| Roles | Owner (admin), captain, and student, all enforced on the server. |
| Moderation | The owner can promote/demote captains, reset passwords, and remove any note or photo. |
| Media delivery | Redirects note images to Cloudinary-hosted optimized URLs. |
| Deployment | Runs locally as a Node.js server or on Vercel as a serverless app. |

---

## Technology stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- Responsive static UI served from `public/`

### Backend

- Node.js
- Express 5
- Multer for multipart photo uploads
- express-session for signed-in sessions
- bcryptjs for password hashing

### Database

- TiDB Cloud
- PostgreSQL-compatible endpoint at port `5432`
- `pg` Node.js driver

### Media storage

- Cloudinary
- Automatic image format and quality optimization

### Hosting

- Local Node.js server for development
- Vercel static hosting for `public/`
- Vercel serverless function for `/api/*`

---

## Application architecture

```text
Browser UI (public/)
        │
        │ static pages + fetch requests
        ▼
Express API (server.js)
        │
        ├── accounts and sessions ──► TiDB Cloud
        ├── note metadata ─────────► TiDB Cloud
        └── uploaded photos ───────► Cloudinary
```

The app is intentionally simple:

1. The frontend calls `/api/notes`, `/api/auth/*`, and image endpoints.
2. Express validates requests, stores note and account records in TiDB, and
   sends image files to Cloudinary.
3. Cloudinary stores the image content; TiDB stores the Cloudinary URLs and
   metadata.
4. The browser renders note cards and opens a multi-page photo viewer.

---

## Main data model

| Table | Purpose |
| --- | --- |
| `users` | Student accounts and password hashes. |
| `notes` | Subject, title, class date, caption, owner, and primary image data. |
| `note_photos` | Ordered photo list for multi-page notes. |
| `session_store` | Login sessions. |
| `student_notes` | Uploaded image references grouped by student and subject. |

---

## Security and validation

- Passwords are hashed with bcrypt and are never stored in plain text.
- Login sessions use HTTP-only cookies.
- Database access uses parameterized SQL queries.
- Uploads are checked by file signature, not only by file extension.
- Each image is limited to 8 MB; each note is limited to 8 photos.
- Upload and delete routes check the user's role in the database on every
  request, so removing a captain takes effect immediately.
- Delete operations verify `uploader_id` on the server (owners can delete any
  note).
- Security headers are applied to responses.
- Production sessions require a real `SESSION_SECRET`.

---

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Configure environment variables

Copy the example file:

```sh
cp .env.example .env
```

Fill in the required values:

```env
SESSION_SECRET=replace-with-a-long-random-string
APP_TIMEZONE=Asia/Dhaka
PORT=5000

TIDB_HOST=your-tidb-host
TIDB_PORT=5432
TIDB_USER=your-tidb-user
TIDB_PASSWORD=your-tidb-password
TIDB_DATABASE=postgres

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

ADMIN_EMAILS=owner@example.com
```

`ADMIN_EMAILS` is a comma-separated list of owner emails. An account with one
of these emails becomes the owner (admin) when it signs in.

### 3. Run locally

```sh
npm run dev
```

Open:

```text
http://localhost:5000
```

For a normal non-watch run, use:

```sh
npm start
```

---

## Vercel deployment

The repository is already structured for Vercel:

- `vercel.json` sets `public/` as the static output, gives API functions up to
  60 seconds for photo uploads, and applies the app's security headers to
  static pages.
- `public/` is deployed as static frontend content.
- `api/[...slug].js` routes `/api/*` requests to the Express app.
- No build step is required.

Deployment steps:

1. Import the repository into Vercel.
2. Add all environment variables from `.env.example` in **Project Settings →
   Environment Variables**.
3. Omit `PORT` on Vercel; Vercel manages the listening port.
4. Deploy.
5. Open `/api/health` on the deployed site. It returns `"ok": true` when the
   database is connected. Otherwise it lists missing variables, values wrapped
   in quotes or spaces, and the database error, without revealing any secrets.
   After changing variables, redeploy before checking again.

---

## Roles and accounts

| Role | Can do |
| --- | --- |
| Owner (admin) | Everything a captain can, plus add captains, make/remove captains, reset passwords, and remove any note or single photo. |
| Captain | Sign in, upload notes, and remove their own notes or photos. |
| Student | Browse, search, filter, and open notes. No account needed. |

How to manage captains:

1. Set `ADMIN_EMAILS` to the email of your existing account and redeploy.
2. Sign in with that account and click **Manage** in the header.
3. Add a captain with a name, email, and password, then share those login
   details with the captain.
4. Use **Remove captain** or **Make captain** to change upload access at any
   time.

There is no public sign-up. Accounts created before this change keep their
notes but become students, so they can no longer upload until the owner makes
them captains.

The database also seeds sample notes when the `notes` table is empty.

---

## How this project can scale

### Near-term improvements

- Add edit support for note titles, captions, subjects, and dates.
- Let students remove or reorder selected photos before submitting.
- Add pagination or infinite scrolling for large note collections.
- Add profile pages showing each student's uploads and contributions.
- Add dark mode and stronger mobile upload guidance.

### Product scale

- Add class groups or private study circles with invite links.
- Add comments, reactions, bookmarks, and “helpful” votes.
- Add teacher or moderator approval for shared notes.
- Add notifications when new notes are posted for a subject.
- Add OCR search so handwritten text inside photos can be searched.

### Technical scale

- Add a database migration tool such as Drizzle, Prisma, or node-pg-migrate.
- Add automated tests for auth, uploads, ownership, and API validation.
- Add structured logging, error reporting, and request metrics.
- Add a queue for Cloudinary cleanup and image processing retries.
- Use CDN caching and signed upload URLs for heavier traffic.
- Split large uploads into direct browser-to-Cloudinary uploads.
- Add rate limiting and abuse protection for login and upload routes.

### Longer-term architecture

- Extract the API into a separate service if the frontend grows.
- Extend roles with teachers or per-subject captains.
- Store audit events for uploads, edits, deletes, and moderation actions.
- Add background jobs for image thumbnails, OCR, malware scanning, and cleanup.
- Introduce full-text search in TiDB or a dedicated search service.

---

## Project structure

```text
.
├── api/
│   └── [...slug].js       # Vercel serverless API entrypoint
├── public/
│   ├── app.js             # Frontend state, auth, upload, filters, viewer
│   ├── index.html         # Page structure and dialogs
│   ├── styles.css         # Responsive design and components
│   └── favicon.svg
├── server.js              # Express app, API routes, schema setup
├── vercel.json            # Vercel static output, function, and header config
├── package.json           # Scripts and dependencies
├── package-lock.json      # Locked dependency versions
├── .env.example           # Required environment variables
└── README.md
```

---

## Development notes

- Keep all SQL statements parameterized.
- Keep upload validation on the server even when browser validation exists.
- Never commit `.env` or real credentials.
- Test login, upload, photo browsing, and delete after changing API routes.
- `npm run dev` uses Node's watch mode for local development.
- `npm start` runs the same server without watch mode.
