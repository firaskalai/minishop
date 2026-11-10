const request = require("supertest");
const jwt = require("jsonwebtoken");

const { app } = require("../src/index");

describe("API Gateway", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("reports the available gateway endpoints at the root", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body.service).toBe("api-gateway");
    expect(response.body.endpoints).toContain("/api/products");
  });

  it("reports its health", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ service: "api-gateway", status: "ok" });
  });

  it("forwards product requests and rewrites the public path", async () => {
    global.fetch.mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify([{ name: "Laptop" }])
    });

    const response = await request(app).get("/api/products");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ name: "Laptop" }]);
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:4001/products", expect.objectContaining({ method: "GET" }));
  });

  it("returns a controlled error when a backend is unavailable", async () => {
    global.fetch.mockRejectedValue(new Error("connection refused"));

    const token = jwt.sign({ id: "2", role: "USER" }, process.env.JWT_SECRET || "minishop-local-development-secret");
    const response = await request(app).get("/api/orders").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("Backend service unavailable");
  });
  describe("product write access", () => {
    const secret = process.env.JWT_SECRET || "minishop-local-development-secret";
    const adminToken = () => jwt.sign({ id: "1", role: "ADMIN" }, secret);
    const userToken = () => jwt.sign({ id: "2", role: "USER" }, secret);
    const okResponse = () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{}"
    });

    it.each([
      ["post", "/api/products"],
      ["put", "/api/products/abc"],
      ["delete", "/api/products/abc"]
    ])("rejects anonymous %s %s", async (method, path) => {
      const response = await request(app)[method](path).send({});
      expect(response.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("rejects non-admin users", async () => {
      const response = await request(app).put("/api/products/abc").set("Authorization", `Bearer ${userToken()}`).send({ image: "" });
      expect(response.status).toBe(403);
    });

    it("lets an admin update a product through the gateway", async () => {
      global.fetch.mockResolvedValue(okResponse());
      const response = await request(app).put("/api/products/abc").set("Authorization", `Bearer ${adminToken()}`).send({ image: "https://example.com/a.jpg" });
      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith("http://localhost:4001/products/abc", expect.objectContaining({ method: "PUT" }));
    });
  });

  describe("order administration", () => {
    const secret = process.env.JWT_SECRET || "minishop-local-development-secret";
    const adminToken = () => jwt.sign({ id: "1", name: "Admin", email: "admin@minishop.local", role: "ADMIN" }, secret);
    const userToken = () => jwt.sign({ id: "2", role: "USER" }, secret);
    const ok = () => ({ status: 200, headers: new Headers({ "content-type": "application/json" }), text: async () => "{}" });

    it.each([
      ["get", "/api/orders/stats"],
      ["get", "/api/orders/manage"],
      ["patch", "/api/orders/abc/accept"],
      ["patch", "/api/orders/abc/reject"]
    ])("rejects anonymous %s %s", async (method, path) => {
      const response = await request(app)[method](path).send({});
      expect(response.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("rejects non-admin users", async () => {
      const response = await request(app).patch("/api/orders/abc/accept").set("Authorization", `Bearer ${userToken()}`);
      expect(response.status).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("routes admin requests to the Order Service with verified identity", async () => {
      global.fetch.mockResolvedValue(ok());
      const response = await request(app)
        .patch("/api/orders/abc/reject")
        .set("Authorization", `Bearer ${adminToken()}`)
        .set("x-user-role", "ADMIN")
        .send({ reason: "Unavailable" });
      expect(response.status).toBe(200);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe("http://localhost:4002/orders/abc/reject");
      expect(options.method).toBe("PATCH");
      expect(options.headers["x-user-id"]).toBe("1");
      expect(options.headers["x-user-role"]).toBe("ADMIN");
      expect(JSON.parse(options.body)).toEqual({ reason: "Unavailable" });
    });

    it("never forwards a client-supplied identity header", async () => {
      global.fetch.mockResolvedValue(ok());
      await request(app)
        .get("/api/orders")
        .set("Authorization", `Bearer ${userToken()}`)
        .set("x-user-role", "ADMIN")
        .set("x-user-id", "evil");
      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers["x-user-role"]).toBe("USER");
      expect(options.headers["x-user-id"]).toBe("2");
    });

    it.each(["/api/orders", "/api/orders/abc"])("requires authentication to read %s", async (path) => {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("lets a logged-in user list their orders", async () => {
      global.fetch.mockResolvedValue(ok());
      expect((await request(app).get("/api/orders").set("Authorization", `Bearer ${userToken()}`)).status).toBe(200);
    });
  });
});
