# big-file-download

A small Express server that serves very large files (1 GB and 5 GB) for download. Use it to test how clients, proxies, browsers or networks handle big downloads, including interrupted downloads that resume.

The server creates each file the first time someone asks for it, saves it in `files/`, and serves the saved copy after that.

## How it works

- **Created when first requested.** No files exist until the first download request for a size. The server then writes a plain-text file of exactly that size, made of a repeated line of sample text.
- **Low memory use.** The file is written to disk in 16 MB chunks, so memory use stays about the same whatever the file size.
- **No half-written files.** Each file is written to a temporary file first and renamed only when complete, so a client never downloads a partial file.
- **Shared generation.** If several requests ask for the same size while it is still being written, they all wait for the same job instead of starting new ones.
- **Streamed and resumable downloads.** Files are streamed with `Content-Length` and `Content-Disposition` headers. `Range` requests are supported, so interrupted downloads can be resumed.

## Requirements

- Node.js 18 or later (the server uses ES modules and top-level `await`)
- Enough free disk space: about 1 GB for the 1 GB file, 5 GB for the 5 GB file, or 6 GB for both

## Install and run

```bash
npm install
npm start
```

The server listens on `http://localhost:3000`. To use another port, set `PORT`:

```bash
PORT=8080 npm start
```

## API

| Method   | Path                  | Description                                              |
| -------- | --------------------- | -------------------------------------------------------- |
| `GET`    | `/`                   | Lists the available endpoints                            |
| `GET`    | `/api/download/:size` | Downloads a file. `size` is `1GB` or `5GB` (any case)    |
| `DELETE` | `/api/files`          | Deletes all generated files to free disk space           |

An invalid `size` returns `400` with the list of valid sizes.

## Usage examples

Download the 1 GB file:

```bash
curl -O -J http://localhost:3000/api/download/1GB
```

Resume a download that was interrupted:

```bash
curl -C - -O -J http://localhost:3000/api/download/5GB
```

Request one byte range:

```bash
curl -H "Range: bytes=0-1023" http://localhost:3000/api/download/1GB
```

Delete the generated files:

```bash
curl -X DELETE http://localhost:3000/api/files
```

You can also open `http://localhost:3000/api/download/1GB` in a browser to download through the browser.

> **Note:** The first request for each size waits until the file has been written (seconds to a minute, depending on your disk) before the download starts. Requests after that start right away.

## Project structure

```
.
├── server.js      # Express server: file generation and download endpoints
├── files/         # Generated files (created at runtime, git-ignored)
└── package.json
```
