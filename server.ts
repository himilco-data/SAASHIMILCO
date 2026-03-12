import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import sqlite3 from "sqlite3";
import multer from "multer";
import fs from "fs";

const app = express();
const PORT = 3000;
const db = new Database("database.sqlite");

// Ensure upload directory exists
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Database Initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT CHECK(role IN ('ADMIN', 'SALARIE', 'CLIENT')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    assigned_to INTEGER,
    debtor_name TEXT NOT NULL,
    amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    invoice_path TEXT,
    status TEXT CHECK(status IN ('EN_ATTENTE', 'EN_COURS', 'RECOUVRE', 'LITIGE')) DEFAULT 'EN_ATTENTE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(client_id) REFERENCES users(id),
    FOREIGN KEY(assigned_to) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(case_id) REFERENCES cases(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Seed Admin if not exists
const adminExists = db.prepare("SELECT * FROM users WHERE role = 'ADMIN'").get();
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync("admin123", 10);
  db.prepare("INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)").run(
    "admin@recouvrement.pro",
    hashedPassword,
    "Admin Principal",
    "ADMIN"
  );
}

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- AUTH ROUTES ---

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Identifiants invalides" });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

app.post("/api/auth/register", (req, res) => {
  const { email, password, name, role } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)").run(
      email,
      hashedPassword,
      name,
      role || "CLIENT"
    );
    res.status(201).json({ message: "Utilisateur créé" });
  } catch (e) {
    res.status(400).json({ error: "Email déjà utilisé" });
  }
});

// --- CASE ROUTES ---

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

app.post("/api/cases", authenticateToken, upload.single("invoice"), (req: any, res) => {
  const { debtor_name, amount, due_date } = req.body;
  const client_id = req.user.id;
  const invoice_path = req.file ? req.file.path : null;

  const result = db.prepare(`
    INSERT INTO cases (client_id, debtor_name, amount, due_date, invoice_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(client_id, debtor_name, amount, due_date, invoice_path);

  db.prepare("INSERT INTO timeline (case_id, user_id, action) VALUES (?, ?, ?)").run(
    result.lastInsertRowid,
    client_id,
    "Création du dossier"
  );

  res.status(201).json({ id: result.lastInsertRowid });
});

app.get("/api/cases", authenticateToken, (req: any, res) => {
  let cases;
  if (req.user.role === "ADMIN") {
    cases = db.prepare(`
      SELECT cases.*, u1.name as client_name, u2.name as assigned_name 
      FROM cases 
      JOIN users u1 ON cases.client_id = u1.id
      LEFT JOIN users u2 ON cases.assigned_to = u2.id
      ORDER BY created_at DESC
    `).all();
  } else if (req.user.role === "SALARIE") {
    cases = db.prepare(`
      SELECT cases.*, u1.name as client_name 
      FROM cases 
      JOIN users u1 ON cases.client_id = u1.id
      WHERE assigned_to = ?
      ORDER BY created_at DESC
    `).all(req.user.id);
  } else {
    cases = db.prepare("SELECT * FROM cases WHERE client_id = ? ORDER BY created_at DESC").all(req.user.id);
  }
  res.json(cases);
});

app.get("/api/cases/:id", authenticateToken, (req: any, res) => {
  const caseData = db.prepare(`
    SELECT cases.*, u1.name as client_name, u2.name as assigned_name 
    FROM cases 
    JOIN users u1 ON cases.client_id = u1.id
    LEFT JOIN users u2 ON cases.assigned_to = u2.id
    WHERE cases.id = ?
  `).get(req.params.id) as any;

  if (!caseData) return res.sendStatus(404);

  // RBAC check
  if (req.user.role === "CLIENT" && caseData.client_id !== req.user.id) return res.sendStatus(403);
  if (req.user.role === "SALARIE" && caseData.assigned_to !== req.user.id) return res.sendStatus(403);

  const timeline = db.prepare(`
    SELECT timeline.*, users.name as user_name, users.role as user_role
    FROM timeline
    JOIN users ON timeline.user_id = users.id
    WHERE case_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  res.json({ ...caseData, timeline });
});

app.patch("/api/cases/:id/status", authenticateToken, (req: any, res) => {
  if (req.user.role !== "ADMIN" && req.user.role !== "SALARIE") return res.sendStatus(403);
  
  const { status, comment } = req.body;
  db.prepare("UPDATE cases SET status = ? WHERE id = ?").run(status, req.params.id);
  
  db.prepare("INSERT INTO timeline (case_id, user_id, action, comment) VALUES (?, ?, ?, ?)").run(
    req.params.id,
    req.user.id,
    `Changement de statut: ${status}`,
    comment
  );

  res.json({ message: "Statut mis à jour" });
});

app.patch("/api/cases/:id/assign", authenticateToken, (req: any, res) => {
  if (req.user.role !== "ADMIN") return res.sendStatus(403);
  
  const { assigned_to } = req.body;
  db.prepare("UPDATE cases SET assigned_to = ? WHERE id = ?").run(assigned_to, req.params.id);
  
  const assignee = db.prepare("SELECT name FROM users WHERE id = ?").get(assigned_to) as any;
  
  db.prepare("INSERT INTO timeline (case_id, user_id, action) VALUES (?, ?, ?)").run(
    req.params.id,
    req.user.id,
    `Dossier assigné à ${assignee.name}`
  );

  res.json({ message: "Dossier assigné" });
});

app.get("/api/users", authenticateToken, (req: any, res) => {
  if (req.user.role !== "ADMIN") return res.sendStatus(403);
  const users = db.prepare("SELECT id, name, email, role FROM users ORDER BY role ASC").all();
  res.json(users);
});

app.get("/api/users/staff", authenticateToken, (req: any, res) => {
  if (req.user.role !== "ADMIN") return res.sendStatus(403);
  const staff = db.prepare("SELECT id, name, email, role FROM users WHERE role IN ('ADMIN', 'SALARIE')").all();
  res.json(staff);
});

// --- VITE MIDDLEWARE ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
