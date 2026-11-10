const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();

app.use(express.json());

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || "http://localhost:4001";

const actorSchema = new mongoose.Schema(
  { id: String, name: String, email: String },
  { _id: false }
);

const MAX_REASON_LENGTH = 500;

const orderSchema = new mongoose.Schema(
  {
    items: [
      {
        productId: {
          type: String,
          required: true
        },
        name: {
          type: String,
          required: true,
          trim: true
        },
        price: {
          type: Number,
          required: true,
          min: 0
        },
        quantity: {
          type: Number,
          required: true,
          min: 1
        }
      }
    ],
    total: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "CANCELLED", "REJECTED"],
      default: "PENDING"
    },
    // Optional fields added for the admin workflow; older orders simply don't have them.
    customer: { type: actorSchema, default: undefined },
    confirmedAt: Date,
    confirmedBy: { type: actorSchema, default: undefined },
    rejectionReason: String,
    rejectedAt: Date,
    rejectedBy: { type: actorSchema, default: undefined },
    statusHistory: {
      type: [{ _id: false, status: String, at: Date, by: { type: actorSchema, default: undefined }, note: String }],
      default: undefined
    }
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", orderSchema);

app.get("/", (req, res) => {
  res.json({
    service: "order-service",
    status: "ok",
    endpoints: ["/health", "/orders", "/orders/:id", "/orders/stats", "/orders/manage"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    service: "order-service",
    status: "ok"
  });
});

// Identity is established and verified by the API Gateway, which forwards it in headers.
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function actorFromHeaders(req) {
  const id = req.get("x-user-id");
  if (!id) return null;
  return { id, name: safeDecode(req.get("x-user-name") || "") || undefined, email: req.get("x-user-email") || undefined, role: req.get("x-user-role") };
}

function requireAdmin(req, res, next) {
  const actor = actorFromHeaders(req);
  if (!actor) return res.status(401).json({ error: "Authentication required" });
  if (actor.role !== "ADMIN") return res.status(403).json({ error: "ADMIN role required" });
  req.actor = { id: actor.id, name: actor.name, email: actor.email };
  next();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

app.get("/orders/stats", requireAdmin, async (req, res, next) => {
  try {
    const rows = await Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$total" } } }]);
    const by = Object.fromEntries(rows.map((row) => [row._id, row]));
    const count = (status) => by[status]?.count || 0;
    res.json({
      total: rows.reduce((sum, row) => sum + row.count, 0),
      pending: count("PENDING"),
      confirmed: count("CONFIRMED"),
      rejected: count("REJECTED"),
      cancelled: count("CANCELLED"),
      confirmedValue: by.CONFIRMED?.value || 0
    });
  } catch (error) {
    next(error);
  }
});

app.get("/orders/manage", requireAdmin, async (req, res, next) => {
  try {
    const { status, q, sort } = req.query;
    const filter = {};

    if (status && status !== "ALL") {
      if (!["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }
      filter.status = status;
    }

    if (typeof q === "string" && q.trim()) {
      const pattern = escapeRegex(q.trim().slice(0, 100));
      filter.$or = [
        { $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: pattern, options: "i" } } },
        { "customer.name": { $regex: pattern, $options: "i" } },
        { "customer.email": { $regex: pattern, $options: "i" } }
      ];
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: sort === "asc" ? 1 : -1, _id: sort === "asc" ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ orders, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  } catch (error) {
    next(error);
  }
});

app.get("/orders", async (req, res, next) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

app.get("/orders/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: "Invalid order ID"
      });
    }

    const order = await Order.findById(req.params.id).lean();

    if (!order) {
      return res.status(404).json({
        error: "Order not found"
      });
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
});

app.post("/orders", async (req, res, next) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Order must include at least one item"
      });
    }

    const validatedItems = [];

    for (const item of items) {
      if (!item || typeof item.productId !== "string" || !item.productId.trim()) {
        return res.status(400).json({
          error: "Invalid order item data"
        });
      }

      if (!mongoose.isValidObjectId(item.productId)) {
        return res.status(400).json({
          error: "Invalid product ID"
        });
      }

      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return res.status(400).json({
          error: "Invalid order item data"
        });
      }

      let productResponse;

      try {
        productResponse = await fetch(`${PRODUCT_SERVICE_URL}/products/${item.productId}`);
      } catch (error) {
        return res.status(503).json({
          error: "Product service unavailable"
        });
      }

      if (!productResponse.ok) {
        const errorPayload = await productResponse.json().catch(() => ({}));
        return res.status(400).json({
          error: errorPayload.error || "Product not found"
        });
      }

      const product = await productResponse.json();

      validatedItems.push({
        productId: item.productId,
        name: product.name,
        price: product.price,
        quantity: item.quantity
      });
    }

    const total = validatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const actor = actorFromHeaders(req);
    const order = await Order.create({
      items: validatedItems,
      total,
      status: "PENDING",
      ...(actor ? { customer: { id: actor.id, name: actor.name, email: actor.email } } : {})
    });

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

async function transitionOrder(req, res, next, status, fields, note) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    const now = new Date();
    // Atomic: only a PENDING order can move, so concurrent requests cannot both succeed.
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, status: "PENDING" },
      {
        $set: { status, ...fields(now) },
        $push: { statusHistory: { status, at: now, by: req.actor, ...(note ? { note } : {}) } }
      },
      { new: true }
    ).lean();

    if (order) return res.json(order);

    const existing = await Order.findById(req.params.id).select("status").lean();
    if (!existing) return res.status(404).json({ error: "Order not found" });
    res.status(409).json({ error: `Order is already ${existing.status} and can no longer be changed` });
  } catch (error) {
    next(error);
  }
}

app.patch("/orders/:id/accept", requireAdmin, (req, res, next) =>
  transitionOrder(req, res, next, "CONFIRMED", (now) => ({ confirmedAt: now, confirmedBy: req.actor }))
);

app.patch("/orders/:id/reject", requireAdmin, (req, res, next) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!reason) return res.status(400).json({ error: "A reason for rejection is required" });
  if (reason.length > MAX_REASON_LENGTH) {
    return res.status(400).json({ error: `Reason must be ${MAX_REASON_LENGTH} characters or fewer` });
  }

  transitionOrder(req, res, next, "REJECTED", (now) => ({ rejectionReason: reason, rejectedAt: now, rejectedBy: req.actor }), reason);
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

async function connectToDatabase() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/minishop_orders";
  await mongoose.connect(mongoUri);
}

async function start() {
  await connectToDatabase();

  const port = Number(process.env.PORT) || 4002;

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`Order Service listening on ${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Order Service startup failed:", error);
    process.exit(1);
  });
}

module.exports = { app, Order, connectToDatabase, start };
