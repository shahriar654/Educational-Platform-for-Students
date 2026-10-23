require("dotenv").config();
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const path = require("node:path");
const { Readable } = require("node:stream");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;

const PORT = Number(process.env.PORT || 5000);
const TIME_ZONE = process.env.APP_TIMEZONE || "Asia/Dhaka";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SUBJECTS = [
  "Bangla",
  "English",
  "ICT",
  "Economics",
  "History",
  "Civics",
  "Geography",
];
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_NOTE_PHOTOS = 8;

function getDatabaseConfig() {
  const host = process.env.TIDB_HOST;
  const user = process.env.TIDB_USER;
  const database = process.env.TIDB_DATABASE;
  if (!host || !user || !database) {
    throw new Error("TIDB_HOST, TIDB_USER, and TIDB_DATABASE must be configured.");
  }
  const ssl = { rejectUnauthorized: true };
  if (process.env.TIDB_CA_CERT) ssl.ca = process.env.TIDB_CA_CERT;
  return {
    host,
    port: Number(process.env.TIDB_PORT || 5432),
    user,
    password: process.env.TIDB_PASSWORD || "",
    database,
    ssl,
  };
}

const pool = new Pool(getDatabaseConfig());

class TidbSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  get(sid, callback) {
    this.pool
      .query(
        "SELECT sess FROM session_store WHERE sid = $1 AND expire >= CURRENT_TIMESTAMP",
        [sid],
      )
      .then(({ rows }) => {
        const sess = rows[0]?.sess;
        callback(null, typeof sess === "string" ? JSON.parse(sess) : sess || null);
      })
      .catch(callback);
  }

  set(sid, sess, callback) {
    const expires = sess?.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + (sess?.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000));
    this.pool
      .query(
        `INSERT INTO session_store (sid, sess, expire)
         VALUES ($1, $2, $3::timestamp)
         ON CONFLICT (sid) DO UPDATE
         SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sess), expires.toISOString()],
      )
      .then(() => callback(null))
      .catch(callback);
  }

  destroy(sid, callback) {
    this.pool
      .query("DELETE FROM session_store WHERE sid = $1", [sid])
      .then(() => callback(null))
      .catch(callback);
  }

  touch(sid, sess, callback) {
    const expires = sess?.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + (sess?.cookie?.maxAge || 7 * 24 * 60 * 60 * 1000));
    this.pool
      .query("UPDATE session_store SET expire = $2::timestamp WHERE sid = $1", [
        sid,
        expires.toISOString(),
      ])
      .then(() => callback(null))
      .catch(callback);
  }
}

const app = express();
let databaseReady = Promise.resolve();
let databaseError = null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_NOTE_PHOTOS },
});

function getCloudinaryClient() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("Cloudinary credentials are not configured.");
    error.code = "CLOUDINARY_NOT_CONFIGURED";
    throw error;
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  return cloudinary;
}

function uploadNotePhoto(buffer) {
  const client = getCloudinaryClient();
  return new Promise((resolve, reject) => {
    const uploadStream = client.uploader.upload_stream(
      { folder: "ndc-humanities-gl", resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id) {
          return reject(new Error("Cloudinary did not return an image id."));
        }
        resolve({
          publicId: result.public_id,
          secureUrl: client.url(result.public_id, {
            secure: true,
            fetch_format: "auto",
            quality: "auto",
          }),
        });
      },
    );
    const source = Readable.from([buffer]);
    source.on("error", reject);
    uploadStream.on("error", reject);
    source.pipe(uploadStream);
  });
}

async function removeCloudinaryPhoto(publicId) {
  try {
    await getCloudinaryClient().uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    console.error("Cloudinary image cleanup failed:", error.message);
  }
}

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' blob: data: https://res.cloudinary.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: "32kb" }));
const REQUIRED_ENV = [
  "TIDB_HOST",
  "TIDB_USER",
  "TIDB_PASSWORD",
  "TIDB_DATABASE",
  "SESSION_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

app.get("/api/health", async (_req, res) => {
  if (databaseError) initializeDatabase();
  await databaseReady.catch(() => {});
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  const suspicious = REQUIRED_ENV.filter((name) =>
    /^\s|\s$|^["']|["']$/.test(process.env[name] || ""),
  );
  const body = {
    ok: !databaseError && !missing.length,
    database: databaseError ? "error" : "connected",
    missingEnv: missing,
    envWithQuotesOrSpaces: suspicious,
    tidb: {
      port: Number(process.env.TIDB_PORT || 5432),
      database: process.env.TIDB_DATABASE || null,
      userHasClusterPrefix: /^[^.]+\.[^.]+$/.test(process.env.TIDB_USER || ""),
    },
  };
  if (databaseError) {
    body.databaseError = { code: databaseError.code || null, message: databaseError.message };
  }
  res.status(body.ok ? 200 : 503).json(body);
});

app.use("/api", (_req, _res, next) => {
  if (databaseError) initializeDatabase();
  databaseReady.then(() => next()).catch(next);
});
app.use(
  "/api",
  session({
    name: "ndcgl.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new TidbSessionStore(pool),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

function todayInDhaka(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000))
    .reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function requireStudent(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Sign in to share a class note." });
  }
  next();
}

function imageFormat(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return output;
}

function makeSamplePage(accent, seed) {
  const width = 720;
  const height = 920;
  const stride = width * 4 + 1;
  const pixels = Buffer.alloc(stride * height);
  const color = accent.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));

  for (let y = 0; y < height; y++) {
    const row = y * stride;
    pixels[row] = 0;
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 4;
      const paper = y > 84 && y < 870 ? 255 - ((x + y + seed) % 6) : 250;
      pixels[offset] = paper;
      pixels[offset + 1] = paper - (paper === 250 ? 3 : 1);
      pixels[offset + 2] = paper - (paper === 250 ? 13 : 6);
      pixels[offset + 3] = 255;
    }
  }

  const rect = (x, y, w, h, rgba) => {
    for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
        const pos = py * stride + 1 + px * 4;
        pixels[pos] = rgba[0];
        pixels[pos + 1] = rgba[1];
        pixels[pos + 2] = rgba[2];
        pixels[pos + 3] = rgba[3] ?? 255;
      }
    }
  };

  rect(50, 64, 5, 790, [235, 117, 112]);
  rect(80, 94, 580, 76, [...color, 30]);
  rect(92, 111, 3, 43, [...color, 255]);
  for (let row = 0, y = 202; y < 828; row++, y += 44) {
    rect(81, y, 565, 2, [199, 213, 224]);
    const wordCount = 3 + ((seed + row * 7) % 5);
    let x = 100;
    for (let word = 0; word < wordCount && x < 620; word++) {
      const wordWidth = 26 + ((seed * 11 + row * 23 + word * 37) % 72);
      const scribble = (tone) => [tone, tone + 5, tone + 10, 255];
      rect(x, y - 13 + ((seed + row) % 4), wordWidth, 3, scribble(76));
      if ((word + row + seed) % 3 === 0) {
        rect(x + 4, y - 7, Math.max(8, wordWidth - 12), 2, scribble(95));
      }
      x += wordWidth + 15;
    }
  }
  rect(102, 330 + (seed % 4) * 44, 235, 17, [...color, 54]);
  rect(95, 532, 510, 88, [252, 239, 207, 255]);
  rect(107, 544, 4, 62, [...color, 255]);
  for (let index = 0; index < 3; index++) {
    rect(129, 552 + index * 19, 160 + ((seed * 17 + index * 49) % 210), 3, [94, 103, 120]);
  }
  rect(612, 101, 24, 24, [...color, 255]);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const image = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(pixels, { level: 8 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return image;
}

async function seedDemoData() {
  const demoEmail = "demo@ndcgl.edu.bd";
  const demoPasswordHash = await bcrypt.hash("NdcStudent2026!", 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ('NDC Demo Student', $1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [demoEmail, demoPasswordHash],
  );

  const { rows: counts } = await pool.query("SELECT COUNT(*)::int AS count FROM notes");
  if (counts[0].count > 0) return;

  const samples = [
    ["Bangla", "কারক ও বিভক্তি", "A quick review of case endings, with examples to practice after class.", "#d97955"],
    ["English", "Complex sentences & clauses", "Independent and dependent clauses, with a few examples from today’s lesson.", "#536e96"],
    ["ICT", "Number systems: binary addition", "Binary place values and a step-by-step addition method.", "#398b83"],
    ["Economics", "Demand, supply & equilibrium", "A concise recap of the factors that shift the demand curve.", "#bd8b38"],
    ["History", "Bengal in the independence movement", "Key events and dates from the lecture, organized as a timeline.", "#a75e68"],
    ["Civics", "Constitutional principles", "A study sheet on the core principles and what they mean in practice.", "#7068a2"],
    ["Geography", "River systems of Bangladesh", "Class notes on river basins, seasonal flow, and floodplains.", "#4486a3"],
  ];

  for (let day = 1; day >= 0; day--) {
    for (let index = 0; index < samples.length; index++) {
      const [subject, title, caption, accent] = samples[index];
      await pool.query(
        `INSERT INTO notes
          (subject, title, lesson_date, caption, image_data, image_mime, author_name, is_sample)
         VALUES ($1, $2, $3::date, $4, $5, 'image/png', $6, TRUE)`,
        [
          subject,
          title,
          todayInDhaka(day),
          caption,
          makeSamplePage(accent, index + day * 13 + 1),
          day === 0 ? "NDC Classmate" : "Study Circle",
        ],
      );
    }
  }
}

app.get("/api/meta", (_req, res) => {
  res.json({ subjects: SUBJECTS, today: todayInDhaka() });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (password.length < 8 || password.length > 100) {
      return res.status(400).json({ error: "Your password must be at least 8 characters." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name, email, passwordHash],
    );
    req.session.user = rows[0];
    res.status(201).json({ user: rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const { rows } = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = $1",
      [email],
    );
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: "Email or password didn’t match." });
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      const { id, name, email: userEmail } = rows[0];
      req.session.user = { id, name, email: userEmail };
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({ user: req.session.user });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("ndcgl.sid", { httpOnly: true, sameSite: "lax" });
    res.json({ ok: true });
  });
});

app.get("/api/notes", async (req, res, next) => {
  try {
    const filters = [];
    const params = [];
    if (req.query.date && req.query.date !== "all") {
      if (!isValidDate(req.query.date)) {
        return res.status(400).json({ error: "Choose a valid class date." });
      }
      params.push(req.query.date);
      filters.push(`lesson_date = $${params.length}::date`);
    }
    if (req.query.subject && req.query.subject !== "all") {
      if (!SUBJECTS.includes(req.query.subject)) {
        return res.status(400).json({ error: "Choose one of the listed subjects." });
      }
      params.push(req.query.subject);
      filters.push(`subject = $${params.length}`);
    }
    const search = String(req.query.q || "").trim().slice(0, 100);
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(title ILIKE $${params.length} OR caption ILIKE $${params.length} OR author_name ILIKE $${params.length})`);
    }
    params.push(100);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT notes.id, subject, title, lesson_date::text AS lesson_date, caption,
              author_name, uploader_id, is_sample, created_at,
              COALESCE(photo_counts.count, 0)::int AS photo_count
       FROM notes
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FROM note_photos WHERE note_id = notes.id
       ) photo_counts ON TRUE
       ${where}
       ORDER BY lesson_date DESC, created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ notes: rows });
  } catch (error) {
    next(error);
  }
});

async function sendNotePhoto(req, res, next, photoIndex = 0) {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    const { rows } = await pool.query(
      `SELECT image_url
       FROM note_photos
       WHERE note_id = $1
       ORDER BY position
       OFFSET $2
       LIMIT 1`,
      [Number(req.params.id), photoIndex],
    );
    if (rows[0]?.image_url) return res.redirect(302, rows[0].image_url);

    if (photoIndex > 0) return res.sendStatus(404);
    const { rows: noteRows } = await pool.query(
      "SELECT image_data, image_mime, note_image_url FROM notes WHERE id = $1",
      [Number(req.params.id)],
    );
    if (!noteRows[0]) return res.sendStatus(404);
    if (noteRows[0].note_image_url) return res.redirect(302, noteRows[0].note_image_url);
    res.set({
      "Content-Type": noteRows[0].image_mime,
      "Cache-Control": "public, max-age=3600",
    });
    res.send(noteRows[0].image_data);
  } catch (error) {
    next(error);
  }
}

app.get("/api/notes/:id/image/:index", (req, res, next) => {
  if (!/^\d+$/.test(req.params.index)) return res.sendStatus(404);
  sendNotePhoto(req, res, next, Number(req.params.index));
});

app.get("/api/notes/:id/image", (req, res, next) => {
  sendNotePhoto(req, res, next);
});

app.post("/api/notes", requireStudent, upload.array("photos", MAX_NOTE_PHOTOS), async (req, res, next) => {
  try {
    const subject = String(req.body.subject || "");
    const title = String(req.body.title || "").trim();
    const caption = String(req.body.caption || "").trim();
    const lessonDate = String(req.body.lessonDate || "");
    if (!SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: "Choose one of the listed subjects." });
    }
    if (title.length < 3 || title.length > 140) {
      return res.status(400).json({ error: "Add a title between 3 and 140 characters." });
    }
    if (caption.length > 1000) {
      return res.status(400).json({ error: "Keep your note description under 1,000 characters." });
    }
    if (!isValidDate(lessonDate) || lessonDate > todayInDhaka()) {
      return res.status(400).json({ error: "Choose today or an earlier class date." });
    }
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "Choose at least one photo of your class notes." });
    }
    if (files.some((file) => !imageFormat(file.buffer))) {
      return res.status(400).json({ error: "Use only valid JPG, PNG, or WebP images." });
    }
    const uploadedPhotos = [];
    try {
      for (const file of files) {
        uploadedPhotos.push({
          ...(await uploadNotePhoto(file.buffer)),
          mime: imageFormat(file.buffer),
        });
      }
    } catch (error) {
      await Promise.all(uploadedPhotos.map((photo) => removeCloudinaryPhoto(photo.publicId)));
      if (error.code === "CLOUDINARY_NOT_CONFIGURED") {
        return res.status(503).json({
          error: "Photo sharing is not configured yet. Please contact the site administrator.",
        });
      }
      console.error("Cloudinary image upload failed:", error.message);
      return res.status(502).json({ error: "Photo upload failed. Please try again." });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO notes
          (subject, title, lesson_date, caption, image_data, image_mime, uploader_id,
           author_name, note_image_url, cloudinary_public_id)
         VALUES ($1, $2, $3::date, $4, NULL, $5, $6, $7, $8, $9)
         RETURNING id, subject, title, lesson_date::text AS lesson_date, caption,
                   author_name, uploader_id, is_sample, created_at`,
        [
          subject,
          title,
          lessonDate,
          caption,
          uploadedPhotos[0].mime,
          req.session.user.id,
          req.session.user.name,
          uploadedPhotos[0].secureUrl,
          uploadedPhotos[0].publicId,
        ],
      );
      for (const [index, photo] of uploadedPhotos.entries()) {
        await client.query(
          `INSERT INTO note_photos (note_id, image_url, cloudinary_public_id, image_mime, position)
           VALUES ($1, $2, $3, $4, $5)`,
          [rows[0].id, photo.secureUrl, photo.publicId, photo.mime, index],
        );
        await client.query(
          `INSERT INTO student_notes (student_name, subject, note_image_url)
           VALUES ($1, $2, $3)`,
          [req.session.user.name, subject, photo.secureUrl],
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ note: { ...rows[0], photo_count: uploadedPhotos.length } });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Note save rollback failed:", rollbackError.message);
        }
      }
      await Promise.all(uploadedPhotos.map((photo) => removeCloudinaryPhoto(photo.publicId)));
      if (error.code === "23505") {
        return res.status(409).json({
          error: "You’ve already shared a note for this subject and date.",
        });
      }
      next(error);
    } finally {
      client?.release();
    }
  } catch (error) {
    next(error);
  }
});

app.delete("/api/notes/:id", requireStudent, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404);
    const client = await pool.connect();
    let deletedNote;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT note_image_url, cloudinary_public_id
         FROM notes
         WHERE id = $1 AND uploader_id = $2 AND is_sample = FALSE
         FOR UPDATE`,
        [Number(req.params.id), req.session.user.id],
      );
      deletedNote = rows[0];
      if (!deletedNote) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "That note is not yours to remove." });
      }
      const { rows: photoRows } = await client.query(
        "SELECT image_url, cloudinary_public_id FROM note_photos WHERE note_id = $1",
        [Number(req.params.id)],
      );
      const imageUrls = [
        ...new Set([
          deletedNote.note_image_url,
          ...photoRows.map((photo) => photo.image_url),
        ].filter(Boolean)),
      ];
      if (imageUrls.length) {
        await client.query("DELETE FROM student_notes WHERE note_image_url = ANY($1::text[])", [imageUrls]);
      }
      deletedNote.photoPublicIds = [
        ...new Set([
          deletedNote.cloudinary_public_id,
          ...photoRows.map((photo) => photo.cloudinary_public_id),
        ].filter(Boolean)),
      ];
      await client.query("DELETE FROM notes WHERE id = $1", [Number(req.params.id)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await Promise.all(
      deletedNote.photoPublicIds.map((publicId) => removeCloudinaryPhoto(publicId)),
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/favicon.ico", (_req, res) => {
  res.type("image/svg+xml").sendFile(path.join(__dirname, "public", "favicon.svg"));
});

app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    etag: process.env.NODE_ENV === "production",
    setHeaders(res) {
      if (process.env.NODE_ENV !== "production") {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }),
);
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "That photo is too large. The maximum size is 8 MB."
        : "Choose up to 8 photos to upload.";
    return res.status(400).json({ error: message });
  }
  console.error(error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

function initializeDatabase() {
  databaseError = null;
  databaseReady = (async () => {
    await pool.query("SELECT 1");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        email VARCHAR(254) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        subject VARCHAR(40) NOT NULL,
        title VARCHAR(140) NOT NULL,
        lesson_date DATE NOT NULL,
        caption TEXT,
        image_data BYTEA,
        image_mime VARCHAR(100),
        uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(80) NOT NULL,
        is_sample BOOLEAN NOT NULL DEFAULT FALSE,
        note_image_url TEXT,
        cloudinary_public_id VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT one_note_per_subject_day UNIQUE (uploader_id, subject, lesson_date)
      )`,
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS session_store (
        sid VARCHAR(255) PRIMARY KEY,
        sess TEXT NOT NULL,
        expire TIMESTAMP NOT NULL
      )`,
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS note_photos (
        id SERIAL PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        cloudinary_public_id VARCHAR(255),
        image_mime VARCHAR(100),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT one_photo_position UNIQUE (note_id, position)
      )`,
    );
    await pool.query(
      `INSERT INTO note_photos (note_id, image_url, cloudinary_public_id, image_mime, position)
       SELECT id, note_image_url, cloudinary_public_id, image_mime, 0
       FROM notes
       WHERE note_image_url IS NOT NULL
       ON CONFLICT (note_id, position) DO NOTHING`,
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS student_notes (
        id SERIAL PRIMARY KEY,
        student_name VARCHAR(80) NOT NULL,
        subject VARCHAR(40) NOT NULL,
        date_uploaded TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        note_image_url TEXT NOT NULL
      )`,
    );
    await seedDemoData();
  })();
  databaseReady.then(
    () => console.log("Database initialization completed."),
    (error) => {
      databaseError = error;
      console.error("Database initialization failed:", error.message);
    },
  );
}

initializeDatabase();

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`NDC Humanities G-L is running on port ${PORT}.`);
  });
}

module.exports = app;
