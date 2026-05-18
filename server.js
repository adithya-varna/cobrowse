const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Set(), url: "" });
  return rooms.get(roomId);
}

wss.on("connection", (ws, req) => {
  const params = new URL(req.url, "http://localhost").searchParams;
  const roomId = params.get("room");
  if (!roomId) return ws.close();

  const room = getOrCreateRoom(roomId);
  room.clients.add(ws);

  ws.color = `hsl(${Math.floor(Math.random() * 360)},70%,55%)`;
  ws.userId = Math.random().toString(36).slice(2, 7);

  if (room.url) ws.send(JSON.stringify({ type: "url_change", url: room.url }));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "url_change") room.url = msg.url;
    for (const client of room.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(JSON.stringify({ ...msg, color: ws.color, userId: ws.userId }));
      }
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    for (const client of room.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "cursor_leave", userId: ws.userId }));
      }
    }
    if (room.clients.size === 0) rooms.delete(roomId);
  });
});

app.get("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url param");
  let targetUrl;
  try { targetUrl = new URL(target); } catch { return res.status(400).send("Invalid URL"); }

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CoBrowse/1.0)",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let html = await response.text();
      const base = `${targetUrl.protocol}//${targetUrl.host}`;
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">`);
      html = html.replace(/if\s*\(\s*(?:window\.)?top\s*[!=]=+\s*(?:window\.)?(?:self|window)\s*\)/gi, "if(false)");
      html = html.replace(/top\.location(?:\.href)?\s*=/gi, "void(0);//");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.send(html);
    } else {
      res.setHeader("Content-Type", contentType);
      response.body.pipe(res);
    }
  } catch (err) {
    res.status(502).send(`Could not fetch page: ${err.message}`);
  }
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));