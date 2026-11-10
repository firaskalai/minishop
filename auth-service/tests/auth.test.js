const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app, User } = require("../src/index");

describe("Auth Service", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri("minishop_auth"));
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer?.stop();
  });

  beforeEach(async () => {
    await User.deleteMany();
  });

  it("registers a user and returns a token", async () => {
    const response = await request(app).post("/auth/register").send({ name: "Ari User", email: "ari@example.com", password: "password123" });
    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("USER");
    expect(response.body.token).toEqual(expect.any(String));
  });

  it("logs in with valid credentials", async () => {
    await request(app).post("/auth/register").send({ name: "Ari User", email: "ari@example.com", password: "password123" });
    const response = await request(app).post("/auth/login").send({ email: "ari@example.com", password: "password123" });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("ari@example.com");
  });

  it("rejects invalid credentials", async () => {
    const response = await request(app).post("/auth/login").send({ email: "missing@example.com", password: "password123" });
    expect(response.status).toBe(401);
  });
});
