import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(__dirname, 'files');
const PORT = process.env.PORT || 3000;

const GB = 1024 ** 3;
const SIZES = { '1GB': 1 * GB, '5GB': 5 * GB };
const LINE = 'This is a sample line of text used to fill a large test file.\n';
// Write ~16 MB at a time; a whole number of lines so no line is split between chunks.
const CHUNK_SIZE = Math.floor((16 * 1024 * 1024) / LINE.length) * LINE.length;

// Tracks in-progress generations so concurrent requests share one job.
const pending = new Map();

/**
 * Creates a file of exactly `size` bytes by streaming chunks to disk,
 * so memory use stays at ~CHUNK_SIZE no matter how big the file is.
 * Writes to a temp file first and renames it, so a half-written file
 * is never served.
 */
async function generateFile(filePath, size) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const out = fs.createWriteStream(tmpPath);
  const chunk = Buffer.from(LINE.repeat(CHUNK_SIZE / LINE.length)); // plain text lines

  try {
    let written = 0;
    while (written < size) {
      const n = Math.min(CHUNK_SIZE, size - written);
      if (!out.write(n === CHUNK_SIZE ? chunk : chunk.subarray(0, n))) {
        await once(out, 'drain'); // respect backpressure
      }
      written += n;
    }
    out.end();
    await once(out, 'finish');
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    out.destroy();
    await fsp.rm(tmpPath, { force: true });
    throw err;
  }
}

/** Returns the path to a ready file of the given size, creating it if needed. */
async function ensureFile(label) {
  const size = SIZES[label];
  const filePath = path.join(FILES_DIR, `bigfile-${label}.txt`);

  const stat = await fsp.stat(filePath).catch(() => null);
  if (stat && stat.size === size) return filePath;

  if (!pending.has(label)) {
    console.log(`Generating ${label} file...`);
    const started = Date.now();
    const job = generateFile(filePath, size)
      .then(() => console.log(`Generated ${label} in ${((Date.now() - started) / 1000).toFixed(1)}s`))
      .finally(() => pending.delete(label));
    pending.set(label, job);
  }
  await pending.get(label);
  return filePath;
}

const app = express();

app.get('/', (_req, res) => {
  res.json({
    endpoints: {
      'GET /api/download/:size': `Download a generated file. size = ${Object.keys(SIZES).join(' | ')}`,
      'DELETE /api/files': 'Delete generated files to free disk space',
    },
  });
});

app.get('/api/download/:size', async (req, res, next) => {
  const label = req.params.size.toUpperCase();
  if (!SIZES[label]) {
    return res.status(400).json({ error: `Invalid size. Use one of: ${Object.keys(SIZES).join(', ')}` });
  }

  try {
    const filePath = await ensureFile(label);
    // res.download streams the file (no full buffering), sets
    // Content-Disposition/Content-Length, and supports Range requests
    // so interrupted downloads can be resumed.
    res.download(filePath, `bigfile-${label}.txt`, (err) => {
      if (err && !res.headersSent) next(err);
      else if (err) console.warn(`Download of ${label} aborted: ${err.message}`);
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/files', async (_req, res, next) => {
  try {
    await fsp.rm(FILES_DIR, { recursive: true, force: true });
    await fsp.mkdir(FILES_DIR, { recursive: true });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

await fsp.mkdir(FILES_DIR, { recursive: true });
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
