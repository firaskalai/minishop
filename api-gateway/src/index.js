const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "3mb" }));

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || "http://localhost:4001";
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || "http://localhost:4002";
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:4003";
const JWT_SECRET = process.env.JWT_SECRET || "minishop-local-development-secret";

app.get("/", (req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok",
    endpoints: ["/health", "/api/auth", "/api/products", "/api/orders"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok"
  });
});

async function proxyRequest(req, res, serviceUrl, servicePath) {
  try {
    const response = await fetch(`${serviceUrl}${servicePath}`, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        // Identity comes only from the verified JWT, never from client-supplied headers.
        ...(req.user ? {
          "x-user-id": String(req.user.id || ""),
          "x-user-role": String(req.user.role || ""),
          "x-user-name": encodeURIComponent(req.user.name || ""),
          "x-user-email": String(req.user.email || "")
        } : {})
      },
      body: ["GET", "HEAD", "DELETE"].includes(req.method) ? undefined : JSON.stringify(req.body)
    });

    const contentType = response.headers.get("content-type");
    const body = await response.text();

    if (contentType) {
      res.type(contentType);
    }

    res.status(response.status).send(body);
  } catch (error) {
    console.error("Gateway proxy request failed:", error.message);
    res.status(503).json({
      error: "Backend service unavailable"
    });
  }
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (req.user.role !== role) return res.status(403).json({ error: `${role} role required` });
      next();
    });
  };
}

app.use("/api/auth", (req, res) => {
  const suffix = req.path === "/" ? "" : req.path;
  proxyRequest(req, res, AUTH_SERVICE_URL, `/auth${suffix}`);
});

app.use("/api/products", (req, res) => {
  const suffix = req.path === "/" ? "" : req.path;
  const forward = () => proxyRequest(req, res, PRODUCT_SERVICE_URL, `/products${suffix}`);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return requireRole("ADMIN")(req, res, forward);
  forward();
});

app.use("/api/orders", (req, res) => {
  const suffix = req.path === "/" ? "" : req.path;
  const forward = () => proxyRequest(req, res, ORDER_SERVICE_URL, `/orders${suffix}`);
  // Admin-only: dashboard data and accept/reject transitions.
  const isAdminRoute = req.method === "PATCH" || (req.method === "GET" && (req.path === "/stats" || req.path === "/manage"));
  if (isAdminRoute) return requireRole("ADMIN")(req, res, forward);
  if (req.method === "POST") return requireAuth(req, res, forward);
  forward();
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

async function start() {
  const port = Number(process.env.PORT) || 4000;

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`API Gateway listening on ${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("API Gateway startup failed:", error);
    process.exit(1);
  });
}

module.exports = { app, proxyRequest, start };
