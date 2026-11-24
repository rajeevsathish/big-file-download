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
const MIN_GB = 1;
const MAX_GB = 100;

/** Parses "7", "7GB" or "7gb" into a whole number of GB in range, or returns null. */
function parseSizeGB(param) {
  const match = /^(\d+)(gb)?$/i.exec(param);
  if (!match) return null;
  const gb = Number(match[1]);
  return gb >= MIN_GB && gb <= MAX_GB ? gb : null;
}
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
async function ensureFile(gb) {
  const label = `${gb}GB`;
  const size = gb * GB;
  const filePath = path.join(FILES_DIR, `bigfile-${label}.txt`);

  const stat = await fsp.stat(filePath).catch(() => null);
  if (stat && stat.size === size) return filePath;

  if (!pending.has(label)) {
    // Refuse up front rather than fill the disk partway and fail.
    const { bavail, bsize } = await fsp.statfs(FILES_DIR);
    const free = bavail * bsize;
    if (free < size) {
      const err = new Error(
        `Not enough disk space for ${label}: ${(free / GB).toFixed(1)} GB free. Delete generated files with DELETE /api/files.`
      );
      err.status = 507;
      throw err;
    }
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
      'GET /api/download/:size': `Download a generated file of that many GB. size = ${MIN_GB}-${MAX_GB} (e.g. 7 or 7GB)`,
      'DELETE /api/files': 'Delete generated files to free disk space',
    },
  });
});

app.get('/api/download/:size', async (req, res, next) => {
  const gb = parseSizeGB(req.params.size);
  if (gb === null) {
    return res
      .status(400)
      .json({ error: `Invalid size. Use a whole number of GB from ${MIN_GB} to ${MAX_GB}, e.g. 7 or 7GB.` });
  }
  const label = `${gb}GB`;

  try {
    const filePath = await ensureFile(gb);
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
  res.status(err.status || 500).json({ error: err.message });
});

await fsp.mkdir(FILES_DIR, { recursive: true });
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
