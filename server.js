const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer((req, res) => {
  const requestPath = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const decodedPath = decodeURIComponent(requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, ""));

  const filePath = path.resolve(BASE_DIR, decodedPath);
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { "Content-Type": "text/html" });
    res.end("<h1>403 - Forbidden</h1>");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 - File Not Found</h1>");
      } else {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<h1>500 - Internal Server Error</h1>");
      }
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": "no-cache",
      "Content-Length": content.length
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    res.end(content);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Launchpad Music Server running at http://localhost:${PORT}`);
  console.log(`Press Ctrl+C to stop`);
});

process.on("SIGINT", () => {
  console.log("\nServer stopped");
  process.exit(0);
});
