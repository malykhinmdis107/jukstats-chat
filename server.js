require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json());

// Firebase
let db = null;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  db = admin.firestore();
  console.log('🔥 Firebase OK');
} catch(e) {
  console.error('Firebase error:', e.message);
}

app.get('/', (req, res) => res.json({ status: 'chat-api' }));

// ===== ИСТОРИЯ ЧАТА =====
app.get('/api/chat/:clanId/history', async (req, res) => {
  if (!db) return res.json({ general: [], officer: [] });
  try {
    const snapshot = await db
      .collection('clans').doc(req.params.clanId)
      .collection('messages')
      .orderBy('time', 'desc')
      .limit(200)
      .get();
    
    const all = [];
    snapshot.forEach(d => all.push(d.data()));
    
    const general = all.filter(m => !m.isOfficer).slice(0, 100);
    const officer = all.filter(m => m.isOfficer).slice(0, 100);
    
    res.json({ general, officer });
  } catch(e) {
    console.error('History error:', e.message);
    res.json({ general: [], officer: [] });
  }
});

// ===== СОХРАНЕНИЕ СООБЩЕНИЯ =====
app.post('/api/chat/:clanId/message', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    const { message, isOfficer } = req.body;
    if (!message?.id) return res.status(400).json({ error: 'no message' });
    message.isOfficer = !!isOfficer;
    await db.collection('clans').doc(req.params.clanId)
      .collection('messages').doc(String(message.id)).set(message);
    broadcast(req.params.clanId, { type: 'new_message', data: message, isOfficer: !!isOfficer });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== УДАЛЕНИЕ СООБЩЕНИЯ =====
app.delete('/api/chat/:clanId/message/:messageId', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    await db.collection('clans').doc(req.params.clanId)
      .collection('messages').doc(req.params.messageId).delete();
    broadcast(req.params.clanId, { type: 'delete', id: req.params.messageId });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ДОСКА ОБЪЯВЛЕНИЙ =====
app.get('/api/chat/:clanId/board', async (req, res) => {
  if (!db) return res.json([]);
  try {
    const snap = await db.collection('clans').doc(req.params.clanId)
      .collection('board')
      .orderBy('id', 'desc')
      .limit(50)
      .get();
    const board = [];
    snap.forEach(d => board.push(d.data()));
    res.json(board);
  } catch(e) { res.json([]); }
});

app.post('/api/chat/:clanId/board', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    const item = req.body.item;
    if (!item?.id) return res.status(400).json({ error: 'no item id' });
    await db.collection('clans').doc(req.params.clanId)
      .collection('board').doc(String(item.id)).set(item);
    broadcast(req.params.clanId, { type: 'board_update', item });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/chat/:clanId/board/:itemId', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    await db.collection('clans').doc(req.params.clanId)
      .collection('board').doc(req.params.itemId).delete();
    broadcast(req.params.clanId, { type: 'board_delete', id: req.params.itemId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== МОДЕРАЦИЯ =====
app.get('/api/chat/:clanId/moderation', async (req, res) => {
  if (!db) return res.json({ muted: {}, banned: {} });
  try {
    const doc = await db.collection('clans').doc(req.params.clanId)
      .collection('moderation').doc('state').get();
    res.json(doc.exists ? doc.data() : { muted: {}, banned: {} });
  } catch(e) { res.json({ muted: {}, banned: {} }); }
});

app.post('/api/chat/:clanId/moderation', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    await db.collection('clans').doc(req.params.clanId)
      .collection('moderation').doc('state').set(req.body);
    broadcast(req.params.clanId, { type: 'moderation_update' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== РОЛИ САЙТА =====
app.get('/api/chat/:clanId/roles', async (req, res) => {
  if (!db) return res.json({});
  try {
    const doc = await db.collection('clans').doc(req.params.clanId)
      .collection('moderation').doc('roles').get();
    res.json(doc.exists ? doc.data() : {});
  } catch(e) { res.json({}); }
});

app.post('/api/chat/:clanId/roles', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    await db.collection('clans').doc(req.params.clanId)
      .collection('moderation').doc('roles').set(req.body);
    broadcast(req.params.clanId, { type: 'role_update' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== ЧАТ-ЛОГ =====
app.get('/api/chat/:clanId/log', async (req, res) => {
  if (!db) return res.json([]);
  try {
    const snap = await db.collection('clans').doc(req.params.clanId)
      .collection('logs')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    const log = [];
    snap.forEach(d => log.push(d.data()));
    res.json(log);
  } catch(e) { res.json([]); }
});

app.post('/api/chat/:clanId/log', async (req, res) => {
  if (!db) return res.json({ success: false });
  try {
    const entry = {
      ...req.body.entry,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('clans').doc(req.params.clanId)
      .collection('logs').add(entry);
    broadcast(req.params.clanId, { type: 'log_update', entry: req.body.entry });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== WEBSOCKET =====
const wss = new WebSocket.Server({ server });
const rooms = new Map();

function broadcast(clanId, data) {
  const room = rooms.get(String(clanId));
  if (room) {
    const msg = JSON.stringify(data);
    room.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(msg);
    });
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clanId = url.pathname.split('/').pop();
  if (!rooms.has(clanId)) rooms.set(clanId, new Set());
  rooms.get(clanId).add(ws);
  
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data);
      rooms.get(clanId)?.forEach(c => {
        if (c !== ws && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg));
      });
    } catch(e) {}
  });
  
  ws.on('close', () => {
    rooms.get(clanId)?.delete(ws);
    if (rooms.get(clanId)?.size === 0) rooms.delete(clanId);
  });
});

// Keep-alive
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (url) {
    require('https').get(url + '/', () => {}).on('error', () => {});
  }
}, 10 * 60 * 1000);

// Временный эндпоинт — проверка что в коллекции
app.get('/api/chat/:clanId/debug', async (req, res) => {
  if (!db) return res.json({ error: 'no db' });
  try {
    const snapshot = await db
      .collection('clans').doc(req.params.clanId)
      .collection('messages')
      .limit(5)
      .get();
    
    const docs = [];
    snapshot.forEach(d => {
      docs.push({
        id: d.id,
        exists: d.exists,
        data: d.data()
      });
    });
    
    res.json({ 
      count: snapshot.size, 
      empty: snapshot.empty,
      docs 
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ CHAT:${PORT}`));
