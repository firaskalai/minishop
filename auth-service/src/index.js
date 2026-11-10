const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "minishop-local-development-secret";
const TOKEN_TTL = process.env.JWT_TTL || "2h";
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

app.use(express.json());

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["USER", "ADMIN"], default: "USER" },
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

function publicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
}

function createToken(user) {
  return jwt.sign(publicUser(user), JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function validateCredentials(email, password) {
  return typeof email === "string" && email.includes("@") && typeof password === "string" && password.length >= 8;
}

app.get("/", (req, res) => {
  res.json({ service: "auth-service", status: "ok", endpoints: ["/health", "/auth/register", "/auth/login", "/auth/me"] });
});

app.get("/health", (req, res) => {
  res.json({ service: "auth-service", status: "ok" });
});

app.get("/auth/health", (req, res) => {
  res.json({ service: "auth-service", status: "ok" });
});

app.post("/auth/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (typeof name !== "string" || name.trim().length < 2 || !validateCredentials(normalizedEmail, password)) {
      return res.status(400).json({ error: "Name, valid email, and password of at least 8 characters are required" });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) return res.status(409).json({ error: "Email is already registered" });

    const passwordHash = await bcrypt.hash(password, 12);
    const role = ADMIN_EMAILS.has(normalizedEmail) ? "ADMIN" : "USER";
    const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash, role });

    res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/auth/login", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const { password } = req.body;
    const user = await User.findOne({ email });

    if (!user || typeof password !== "string" || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/auth/me", (req, res) => {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";

  try {
    res.json({ user: jwt.verify(token, JWT_SECRET) });
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error?.code === 11000) return res.status(409).json({ error: "Email is already registered" });
  res.status(500).json({ error: "Internal server error" });
});

async function connectToDatabase() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/minishop_auth";
  await mongoose.connect(mongoUri);
}

async function ensureAdminAccount() {
  const email = (process.env.ADMIN_SEED_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD || "";
  if (!email || password.length < 8) return;

  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({ name: "Admin", email, passwordHash: await bcrypt.hash(password, 12), role: "ADMIN" });
    console.log(`Admin account created for ${email}`);
  } else if (existing.role !== "ADMIN") {
    existing.role = "ADMIN";
    await existing.save();
    console.log(`Existing account ${email} promoted to ADMIN`);
  }
}

async function start() {
  await connectToDatabase();
  await ensureAdminAccount();
  const port = Number(process.env.PORT) || 4003;
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Auth Service listening on ${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Auth Service startup failed:", error);
    process.exit(1);
  });
}

module.exports = { app, User, connectToDatabase, ensureAdminAccount, start };
