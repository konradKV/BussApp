const express = require('express');
const path    = require('path');
const bcrypt  = require('bcrypt');
const sqlite3 = require('better-sqlite3');
const session = require('express-session');
const dotenv  = require('dotenv');

dotenv.config();

// ── DATABASE ──────────────────────────────────────────────
const db = sqlite3('./bussapp.db');

db.prepare(`CREATE TABLE IF NOT EXISTS person (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brukernavn  TEXT NOT NULL UNIQUE,
  passord     TEXT NOT NULL,
  epost       TEXT,
  is_admin    INTEGER DEFAULT 0
)`).run();

// Add is_admin column if it doesn't exist yet (migration for existing DBs)
try { db.prepare('ALTER TABLE person ADD COLUMN is_admin INTEGER DEFAULT 0').run(); } catch (e) {}

db.prepare(`CREATE TABLE IF NOT EXISTS linje (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  linje_nr    TEXT NOT NULL,
  namn        TEXT NOT NULL,
  beskriving  TEXT,
  type        TEXT DEFAULT 'Buss',
  opprettet   TEXT DEFAULT (datetime('now'))
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS linje_stopp (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  linje_id  INTEGER NOT NULL,
  stopp_id  TEXT NOT NULL,
  stopp_namn TEXT NOT NULL,
  rekkefolge INTEGER DEFAULT 0,
  FOREIGN KEY (linje_id) REFERENCES linje(id) ON DELETE CASCADE
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS favoritt_stopp (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL,
  stopp_id   TEXT NOT NULL,
  stopp_namn TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id),
  UNIQUE(person_id, stopp_id)
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS favoritt_linje (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL,
  linje_id   TEXT NOT NULL,
  linje_namn TEXT NOT NULL,
  linje_nr   TEXT,
  FOREIGN KEY (person_id) REFERENCES person(id),
  UNIQUE(person_id, linje_id)
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS reisehistorikk (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id      INTEGER NOT NULL,
  fra_stopp_id   TEXT NOT NULL,
  fra_stopp_namn TEXT NOT NULL,
  til_stopp_id   TEXT NOT NULL,
  til_stopp_namn TEXT NOT NULL,
  tidspunkt      TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (person_id) REFERENCES person(id)
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS billett_produkt (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  namn         TEXT NOT NULL,
  beskriving   TEXT,
  pris         INTEGER NOT NULL,
  varighet_min INTEGER NOT NULL,
  type         TEXT DEFAULT 'enkeltbillett',
  aktiv        INTEGER DEFAULT 1
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS billett (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL,
  produkt_id  INTEGER NOT NULL,
  kjopt       TEXT DEFAULT (datetime('now')),
  gyldig_til  TEXT NOT NULL,
  brukt       INTEGER DEFAULT 0,
  FOREIGN KEY (person_id)  REFERENCES person(id),
  FOREIGN KEY (produkt_id) REFERENCES billett_produkt(id)
)`).run();

// ── EXPRESS ───────────────────────────────────────────────
const saltRounds = 10;
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'bussapp-secret-123',
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, 'public')));

function checkLoggedIn(req, res, next) {
  if (!req.session.loggedIn) return res.sendFile(path.join(__dirname, 'public/login.html'));
  next();
}

function checkAdmin(req, res, next) {
  if (!req.session.loggedIn) return res.status(401).json({ ok: false, error: 'Ikkje innlogga' });
  if (!req.session.isAdmin)  return res.status(403).json({ ok: false, error: 'Berre admin kan gjere dette' });
  next();
}

// ── AUTH ──────────────────────────────────────────────────
app.post('/login', (req, res) => {
  try {
    const user = db.prepare('SELECT id, brukernavn, passord, is_admin FROM person WHERE brukernavn = ?').get(req.body.username);
    if (user && bcrypt.compareSync(req.body.password, user.passord)) {
      req.session.loggedIn = true;
      req.session.username = user.brukernavn;
      req.session.userid   = user.id;
      req.session.isAdmin  = user.is_admin === 1;
      return res.redirect('/');
    }
    res.json({ ok: false, error: 'Feil brukarnavn eller passord' });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: e.message });
  }
});

app.post('/register', (req, res) => {
  try {
    const { username, password, epost } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Fyll inn brukarnavn og passord' });
    const hash = bcrypt.hashSync(password, saltRounds);
    const info = db.prepare('INSERT INTO person (brukernavn, passord, epost) VALUES (?, ?, ?)').run(username, hash, epost || '');
    const user = db.prepare('SELECT id, brukernavn, is_admin FROM person WHERE id = ?').get(info.lastInsertRowid);
    req.session.loggedIn = true;
    req.session.username = user.brukernavn;
    req.session.userid   = user.id;
    req.session.isAdmin  = user.is_admin === 1;
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: false, error: 'Brukarnamnet er allereie teke' });
    res.json({ ok: false, error: e.message });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/', checkLoggedIn, (req, res) => res.sendFile(path.join(__dirname, 'public/app.html')));

app.get('/currentUser', checkLoggedIn, (req, res) => {
  res.json({
    id: req.session.userid,
    username: req.session.username,
    isAdmin: req.session.isAdmin === true
  });
});

// ── LINJER ────────────────────────────────────────────────
app.get('/linjer', checkLoggedIn, (req, res) => {
  const linjer = db.prepare('SELECT * FROM linje ORDER BY CAST(linje_nr AS INTEGER), linje_nr').all();
  res.json(linjer);
});

app.get('/linjer/:id', checkLoggedIn, (req, res) => {
  const linje = db.prepare('SELECT * FROM linje WHERE id = ?').get(parseInt(req.params.id));
  if (!linje) return res.status(404).json({ error: 'Linje ikkje funne' });
  const stopp = db.prepare('SELECT * FROM linje_stopp WHERE linje_id = ? ORDER BY rekkefolge').all(linje.id);
  res.json({ ...linje, stopp });
});

app.post('/linjer', checkAdmin, (req, res) => {
  try {
    const { linje_nr, namn, beskriving, type } = req.body;
    if (!linje_nr || !namn) return res.json({ ok: false, error: 'linje_nr og namn er påkravd' });
    const info = db.prepare('INSERT INTO linje (linje_nr, namn, beskriving, type) VALUES (?, ?, ?, ?)').run(
      linje_nr.trim(), namn.trim(), beskriving || '', type || 'Buss'
    );
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.put('/linjer/:id', checkAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { linje_nr, namn, beskriving, type } = req.body;
    if (!linje_nr || !namn) return res.json({ ok: false, error: 'linje_nr og namn er påkravd' });
    const r = db.prepare('UPDATE linje SET linje_nr=?, namn=?, beskriving=?, type=? WHERE id=?').run(
      linje_nr.trim(), namn.trim(), beskriving || '', type || 'Buss', id
    );
    if (r.changes === 0) return res.json({ ok: false, error: 'Linje ikkje funne' });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.delete('/linjer/:id', checkAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.prepare('DELETE FROM linje_stopp WHERE linje_id = ?').run(id);
    const r = db.prepare('DELETE FROM linje WHERE id = ?').run(id);
    if (r.changes === 0) return res.json({ ok: false, error: 'Linje ikkje funne' });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/linjer/:id/stopp', checkAdmin, (req, res) => {
  try {
    const linje_id = parseInt(req.params.id);
    const { stopp_id, stopp_namn, rekkefolge } = req.body;
    if (!stopp_id) return res.json({ ok: false, error: 'stopp_id er påkravd' });
    db.prepare('INSERT INTO linje_stopp (linje_id, stopp_id, stopp_namn, rekkefolge) VALUES (?, ?, ?, ?)').run(
      linje_id, stopp_id, stopp_namn || stopp_id, rekkefolge || 0
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.delete('/linjer/:linjeid/stopp/:stoppid', checkAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM linje_stopp WHERE linje_id = ? AND stopp_id = ?').run(
      parseInt(req.params.linjeid), req.params.stoppid
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── ROUTE SEARCH ──────────────────────────────────────────
app.get('/api/sokRute', checkLoggedIn, (req, res) => {
  try {
    const { fra, til } = req.query;
    if (!fra || !til) return res.json({ error: 'Manglar fra/til' });

    const linjerMedFra = db.prepare('SELECT linje_id, rekkefolge as fra_rek FROM linje_stopp WHERE stopp_id = ?').all(fra);
    if (linjerMedFra.length === 0) return res.json([]);

    const results = [];
    for (const f of linjerMedFra) {
      const tilRow = db.prepare('SELECT rekkefolge as til_rek FROM linje_stopp WHERE linje_id = ? AND stopp_id = ?').get(f.linje_id, til);
      if (!tilRow) continue;

      const linje = db.prepare('SELECT * FROM linje WHERE id = ?').get(f.linje_id);
      if (!linje) continue;

      const rettRetning = f.fra_rek < tilRow.til_rek;
      const stopp = db.prepare(`
        SELECT stopp_id, stopp_namn, rekkefolge FROM linje_stopp
        WHERE linje_id = ? AND rekkefolge >= ? AND rekkefolge <= ?
        ORDER BY rekkefolge
      `).all(f.linje_id, rettRetning ? f.fra_rek : tilRow.til_rek, rettRetning ? tilRow.til_rek : f.fra_rek);

      results.push({
        linje_id:  linje.id,
        linje_nr:  linje.linje_nr,
        namn:      linje.namn,
        type:      linje.type,
        rettRetning,
        stopp:     rettRetning ? stopp : [...stopp].reverse()
      });
    }

    res.json(results);
  } catch (e) {
    console.error(e);
    res.json({ error: e.message });
  }
});

// ── FAVOURITES ────────────────────────────────────────────
app.get('/favorittStopp', checkLoggedIn, (req, res) => {
  res.json(db.prepare('SELECT * FROM favoritt_stopp WHERE person_id = ? ORDER BY stopp_namn').all(req.session.userid));
});

app.post('/favorittStopp', checkLoggedIn, (req, res) => {
  try {
    const { stopp_id, stopp_namn } = req.body;
    if (!stopp_id) return res.json({ ok: false, error: 'Manglar stopp_id' });
    db.prepare('INSERT OR IGNORE INTO favoritt_stopp (person_id, stopp_id, stopp_namn) VALUES (?, ?, ?)').run(
      req.session.userid, stopp_id, stopp_namn || stopp_id
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.delete('/favorittStopp/:id', checkLoggedIn, (req, res) => {
  try {
    db.prepare('DELETE FROM favoritt_stopp WHERE stopp_id = ? AND person_id = ?').run(req.params.id, req.session.userid);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/favorittLinje', checkLoggedIn, (req, res) => {
  res.json(db.prepare('SELECT * FROM favoritt_linje WHERE person_id = ? ORDER BY linje_nr').all(req.session.userid));
});

app.post('/favorittLinje', checkLoggedIn, (req, res) => {
  try {
    const { linje_id, linje_namn, linje_nr } = req.body;
    if (!linje_id) return res.json({ ok: false, error: 'Manglar linje_id' });
    db.prepare('INSERT OR IGNORE INTO favoritt_linje (person_id, linje_id, linje_namn, linje_nr) VALUES (?, ?, ?, ?)').run(
      req.session.userid, String(linje_id), linje_namn || String(linje_id), linje_nr || ''
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.delete('/favorittLinje/:id', checkLoggedIn, (req, res) => {
  try {
    db.prepare('DELETE FROM favoritt_linje WHERE linje_id = ? AND person_id = ?').run(req.params.id, req.session.userid);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── HISTORIKK ─────────────────────────────────────────────
app.get('/historikk', checkLoggedIn, (req, res) => {
  res.json(db.prepare('SELECT * FROM reisehistorikk WHERE person_id = ? ORDER BY tidspunkt DESC LIMIT 50').all(req.session.userid));
});

app.post('/historikk', checkLoggedIn, (req, res) => {
  try {
    const { fra_stopp_id, fra_stopp_namn, til_stopp_id, til_stopp_namn } = req.body;
    if (!fra_stopp_id || !til_stopp_id) return res.json({ ok: false, error: 'Manglar fra/til' });
    db.prepare('INSERT INTO reisehistorikk (person_id, fra_stopp_id, fra_stopp_namn, til_stopp_id, til_stopp_namn) VALUES (?, ?, ?, ?, ?)').run(
      req.session.userid, fra_stopp_id, fra_stopp_namn || fra_stopp_id, til_stopp_id, til_stopp_namn || til_stopp_id
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── ADMIN ─────────────────────────────────────────────────
app.get('/admin/brukere', checkAdmin, (req, res) => {
  const users = db.prepare('SELECT id, brukernavn, epost, is_admin FROM person ORDER BY id').all();
  res.json(users);
});

app.post('/admin/setAdmin', checkAdmin, (req, res) => {
  try {
    const { user_id, is_admin } = req.body;
    db.prepare('UPDATE person SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, parseInt(user_id));
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── BILLETTAR ─────────────────────────────────────────────
app.get('/api/billett/produkt', checkLoggedIn, (req, res) => {
  res.json(db.prepare('SELECT * FROM billett_produkt WHERE aktiv = 1 ORDER BY pris').all());
});

app.post('/api/billett/kjop', checkLoggedIn, (req, res) => {
  try {
    const { produkt_id } = req.body;
    const produkt = db.prepare('SELECT * FROM billett_produkt WHERE id = ? AND aktiv = 1').get(parseInt(produkt_id));
    if (!produkt) return res.json({ ok: false, error: 'Billettype ikkje funne' });

    const gyldig_til = new Date(Date.now() + produkt.varighet_min * 60 * 1000)
      .toISOString().replace('T',' ').slice(0,19);

    const info = db.prepare('INSERT INTO billett (person_id, produkt_id, gyldig_til) VALUES (?,?,?)').run(
      req.session.userid, produkt.id, gyldig_til
    );

    const billett = db.prepare(`
      SELECT b.*, p.namn, p.beskriving, p.pris, p.varighet_min, p.type as produkt_type
      FROM billett b JOIN billett_produkt p ON p.id = b.produkt_id
      WHERE b.id = ?
    `).get(info.lastInsertRowid);

    res.json({ ok: true, billett });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/billett/mine', checkLoggedIn, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, p.namn, p.beskriving, p.pris, p.varighet_min, p.type as produkt_type
    FROM billett b JOIN billett_produkt p ON p.id = b.produkt_id
    WHERE b.person_id = ? ORDER BY b.kjopt DESC LIMIT 30
  `).all(req.session.userid);
  res.json(rows);
});

// In server.js:
app.get('/api/stopp', checkLoggedIn, (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    // Search stops that are already in the linje_stopp table
    const stops = db.prepare(`
      SELECT DISTINCT stopp_id as id, stopp_namn as namn
      FROM linje_stopp
      WHERE stopp_namn LIKE ?
      ORDER BY stopp_namn
      LIMIT 20
    `).all(`%${q}%`);

    res.json(stops);
  } catch (e) {
    console.error('Stop search error:', e.message);
    res.json({ error: 'Kunne ikkje søkje stoppestader' });
  }
});

// After the GET /api/stopp endpoint, add this:

app.get('/api/stopp/:id', checkLoggedIn, async (req, res) => {
  try {
    const stoppId = req.params.id;

    // Find all lines that serve this stop
    const linjeStoppRows = db.prepare(`
      SELECT ls.*, l.linje_nr, l.namn as linje_namn, l.type
      FROM linje_stopp ls
      JOIN linje l ON l.id = ls.linje_id
      WHERE ls.stopp_id = ?
      ORDER BY l.linje_nr
    `).all(stoppId);

    if (!linjeStoppRows.length) {
      return res.json({
        id: stoppId,
        namn: stoppId,
        avganger: []
      });
    }

    // Get stop name from first result
    const stoppNamn = linjeStoppRows[0].stopp_namn;

    // Convert to departure-like format (static, no real-time data)
    const avganger = linjeStoppRows.map(row => ({
      linje: row.linje_nr,
      retning: row.linje_namn,
      tid: null,  // No real-time data
      forseinka: false,
      forsinkMin: 0,
      realtime: false
    }));

    res.json({
      id: stoppId,
      namn: stoppNamn,
      avganger: avganger
    });

  } catch (e) {
    console.error('Stop detail error:', e.message);
    res.json({
      error: 'Kunne ikkje hente stoppeinformasjon.',
      raw: e.message
    });
  }
});

// ── START ─────────────────────────────────────────────────
app.listen(3000, () => console.log('BussApp kjørar på http://localhost:3000'));
