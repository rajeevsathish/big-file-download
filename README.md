# big-file-download

A small Express server that serves very large files, any whole number of GB from 1 to 100, for download. Use it to test how clients, proxies, browsers or networks handle big downloads, including interrupted downloads that resume.

The server creates each file the first time someone asks for it, saves it in `files/`, and serves the saved copy after that.

## How it works

- **Created when first requested.** No files exist until the first download request for a size. The server then writes a plain-text file of exactly that size, made of a repeated line of sample text.
- **Low memory use.** The file is written to disk in 16 MB chunks, so memory use stays about the same whatever the file size.
- **No half-written files.** Each file is written to a temporary file first and renamed only when complete, so a client never downloads a partial file.
- **Disk space check.** Before creating a file, the server checks there is enough free disk space and returns `507` if there isn't.
- **Shared generation.** If several requests ask for the same size while it is still being written, they all wait for the same job instead of starting new ones.
- **Streamed and resumable downloads.** Files are streamed with `Content-Length` and `Content-Disposition` headers. `Range` requests are supported, so interrupted downloads can be resumed.

## Requirements

- Node.js 18.15 or later (the server uses ES modules, top-level `await` and `fs.statfs`)
- Enough free disk space for the files you request. Each file stays on disk after it is created, so space used adds up: 1 GB + 10 GB + 50 GB needs 61 GB.

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
| `GET`    | `/api/download/:size` | Downloads a file of `size` GB                            |
| `DELETE` | `/api/files`          | Deletes all generated files to free disk space           |

`size` is a whole number from 1 to 100, with or without a `GB` suffix in any case: `7`, `7GB` and `7gb` all give a 7 GB file.

| Status | When                                                           |
| ------ | -------------------------------------------------------------- |
| `400`  | `size` is not a whole number from 1 to 100 (e.g. `0`, `101`, `2.5`) |
| `507`  | Not enough free disk space to create the file                  |

## Usage examples

Download a 1 GB file:

```bash
curl -O -J http://localhost:3000/api/download/1
```

Download a 25 GB file:

```bash
curl -O -J http://localhost:3000/api/download/25GB
```

Resume a download that was interrupted:

```bash
curl -C - -O -J http://localhost:3000/api/download/25
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

> **Note:** The first request for each size waits until the whole file has been written before the download starts. For large sizes this can take several minutes, depending on your disk, and some clients or proxies may time out while waiting. Requests after that start right away.

## Project structure

```
.
├── server.js      # Express server: file generation and download endpoints
├── files/         # Generated files (created at runtime, git-ignored)
└── package.json
```
