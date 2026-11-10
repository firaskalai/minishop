const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { app, Order } = require("../src/index");

describe("Order Service", () => {
  let mongoServer;
  let productId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongoServer.getUri("minishop_orders");
    process.env.PRODUCT_SERVICE_URL = "http://product-service:4001";
    await mongoose.connect(process.env.MONGODB_URI);
    productId = new mongoose.Types.ObjectId().toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Order.deleteMany();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("reports the available order endpoints at the root", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body.service).toBe("order-service");
    expect(response.body.endpoints).toContain("/orders");
  });

  it("creates an order from valid product data", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        _id: productId,
        name: "Laptop",
        price: 1200
      })
    });

    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ productId, quantity: 2 }]
      });

    expect(response.status).toBe(201);
    expect(response.body.total).toBe(2400);
    expect(response.body.status).toBe("PENDING");
  });

  it("rejects orders referencing nonexistent products", async () => {
    const missingProductId = new mongoose.Types.ObjectId().toString();

    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Product not found" })
    });

    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ productId: missingProductId, quantity: 1 }]
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Product not found");
  });

  it("calculates the order total correctly", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        _id: productId,
        name: "Tablet",
        price: 350
      })
    });

    const response = await request(app)
      .post("/orders")
      .send({
        items: [{ productId, quantity: 3 }]
      });

    expect(response.status).toBe(201);
    expect(response.body.total).toBe(1050);
  });

  describe("admin workflow", () => {
    const admin = { "x-user-id": "a1", "x-user-role": "ADMIN", "x-user-name": "Admin", "x-user-email": "admin@minishop.local" };
    const user = { "x-user-id": "u1", "x-user-role": "USER", "x-user-name": "Ari", "x-user-email": "ari@example.com" };
    const make = (extra = {}) => Order.create({ items: [{ productId: "p1", name: "Lamp", price: 50, quantity: 2 }], total: 100, ...extra });

    it("lists pending orders and searches by customer", async () => {
      await make({ customer: { id: "u1", name: "Ari", email: "ari@example.com" } });
      await make({ status: "CONFIRMED" });
      const pending = await request(app).get("/orders/manage?status=PENDING").set(admin);
      expect(pending.status).toBe(200);
      expect(pending.body.orders).toHaveLength(1);
      const search = await request(app).get("/orders/manage?q=ari@example").set(admin);
      expect(search.body.total).toBe(1);
    });

    it("accepts a pending order and records who and when", async () => {
      const order = await make();
      const response = await request(app).patch(`/orders/${order._id}/accept`).set(admin);
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("CONFIRMED");
      expect(response.body.confirmedBy.id).toBe("a1");
      expect(response.body.confirmedAt).toBeDefined();
      expect((await Order.findById(order._id)).status).toBe("CONFIRMED");
    });

    it("rejects an order with a trimmed reason and persists it", async () => {
      const order = await make();
      const response = await request(app).patch(`/orders/${order._id}/reject`).set(admin).send({ reason: "  Out of stock.  " });
      expect(response.status).toBe(200);
      const saved = await Order.findById(order._id).lean();
      expect(saved.status).toBe("REJECTED");
      expect(saved.rejectionReason).toBe("Out of stock.");
      expect(saved.rejectedBy.email).toBe("admin@minishop.local");
      expect(saved.rejectedAt).toBeInstanceOf(Date);
    });

    it.each([[undefined], [""], ["   "], [42], ["x".repeat(501)]])("refuses an invalid reason (%p)", async (reason) => {
      const order = await make();
      const response = await request(app).patch(`/orders/${order._id}/reject`).set(admin).send({ reason });
      expect(response.status).toBe(400);
      expect((await Order.findById(order._id)).status).toBe("PENDING");
    });

    it("accepts a reason of exactly 500 characters", async () => {
      const order = await make();
      const response = await request(app).patch(`/orders/${order._id}/reject`).set(admin).send({ reason: "x".repeat(500) });
      expect(response.status).toBe(200);
    });

    it("requires authentication and the ADMIN role", async () => {
      const order = await make();
      expect((await request(app).patch(`/orders/${order._id}/accept`)).status).toBe(401);
      expect((await request(app).patch(`/orders/${order._id}/accept`).set(user)).status).toBe(403);
      expect((await request(app).patch(`/orders/${order._id}/reject`).set(user).send({ reason: "no" })).status).toBe(403);
      expect((await request(app).get("/orders/stats").set(user)).status).toBe(403);
      expect((await Order.findById(order._id)).status).toBe("PENDING");
    });

    it("returns 404 for a missing order and 400 for a malformed id", async () => {
      const missing = new mongoose.Types.ObjectId();
      expect((await request(app).patch(`/orders/${missing}/accept`).set(admin)).status).toBe(404);
      expect((await request(app).patch("/orders/nope/accept").set(admin)).status).toBe(400);
    });

    it("does not process an already processed order again", async () => {
      const order = await make();
      await request(app).patch(`/orders/${order._id}/reject`).set(admin).send({ reason: "Unavailable" });
      const accept = await request(app).patch(`/orders/${order._id}/accept`).set(admin);
      expect(accept.status).toBe(409);
      const again = await request(app).patch(`/orders/${order._id}/reject`).set(admin).send({ reason: "Different reason" });
      expect(again.status).toBe(409);
      expect((await Order.findById(order._id)).rejectionReason).toBe("Unavailable");
    });

    it("lets only one of two concurrent requests win", async () => {
      const order = await make();
      const results = await Promise.all([
        request(app).patch(`/orders/${order._id}/accept`).set(admin),
        request(app).patch(`/orders/${order._id}/reject`).set(admin).send({ reason: "Race" })
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const saved = await Order.findById(order._id).lean();
      expect(saved.statusHistory).toHaveLength(1);
    });

    it("computes stats from persisted orders", async () => {
      await make();
      await make({ status: "CONFIRMED", total: 300 });
      await make({ status: "CONFIRMED", total: 200 });
      await make({ status: "REJECTED" });
      const response = await request(app).get("/orders/stats").set(admin);
      expect(response.body).toMatchObject({ total: 4, pending: 1, confirmed: 2, rejected: 1, confirmedValue: 500 });
    });

    it("lists only the caller's own orders, even for an admin", async () => {
      await make({ customer: { id: "u1", name: "Ari", email: "ari@example.com" } });
      await make({ customer: { id: "u2", name: "Sam", email: "sam@example.com" } });
      await make({ customer: { id: "a1", name: "Admin", email: "admin@minishop.local" } });
      await make();

      const mine = await request(app).get("/orders").set(user);
      expect(mine.status).toBe(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].customer.id).toBe("u1");

      const adminOwn = await request(app).get("/orders").set(admin);
      expect(adminOwn.body).toHaveLength(1);
      expect(adminOwn.body[0].customer.id).toBe("a1");

      const all = await request(app).get("/orders/manage").set(admin);
      expect(all.body.total).toBe(4);
    });

    it("requires authentication to list orders", async () => {
      expect((await request(app).get("/orders")).status).toBe(401);
    });

    it("only lets the owner or an admin read a single order", async () => {
      const order = await make({ customer: { id: "u1", name: "Ari", email: "ari@example.com" } });
      const other = { ...user, "x-user-id": "u2" };
      expect((await request(app).get(`/orders/${order._id}`)).status).toBe(401);
      expect((await request(app).get(`/orders/${order._id}`).set(other)).status).toBe(404);
      expect((await request(app).get(`/orders/${order._id}`).set(user)).status).toBe(200);
      expect((await request(app).get(`/orders/${order._id}`).set(admin)).status).toBe(200);
    });

    it("stores the customer from forwarded identity on new orders", async () => {
      global.fetch.mockResolvedValue({ ok: true, json: async () => ({ name: "Lamp", price: 50 }) });
      const response = await request(app).post("/orders").set(user).send({ items: [{ productId, quantity: 1 }] });
      expect(response.status).toBe(201);
      expect(response.body.customer).toEqual({ id: "u1", name: "Ari", email: "ari@example.com" });
    });
  });
});
