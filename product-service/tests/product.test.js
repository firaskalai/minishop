const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { app, Product } = require("../src/index");

describe("Product Service", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongoServer.getUri("minishop_products");
    await mongoose.connect(process.env.MONGODB_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();

  it("reports the available product endpoints at the root", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body.service).toBe("product-service");
    expect(response.body.endpoints).toContain("/products");
  });
  });

  beforeEach(async () => {
    await Product.deleteMany();
  });

  it("creates a product", async () => {
    const response = await request(app)
      .post("/products")
      .send({
        name: "Laptop",
        description: "Gaming laptop",
        price: 1200,
        stock: 10
      });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("Laptop");
    expect(response.body.price).toBe(1200);
  });

  it("lists products", async () => {
    await Product.create({
      name: "Keyboard",
      description: "Mechanical",
      price: 90,
      stock: 25
    });

    const response = await request(app).get("/products");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("Keyboard");
  });

  it("rejects invalid product data", async () => {
    const response = await request(app)
      .post("/products")
      .send({
        name: "",
        price: -5,
        stock: -2
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid product data");
  });

  it("returns 404 for an unknown product", async () => {
    const response = await request(app).get(`/products/${new mongoose.Types.ObjectId()}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Product not found");
  });
  it("stores a product image and accepts an image update", async () => {
    const image = "https://example.com/photo.jpg";
    const created = await request(app).post("/products").send({ name: "Lamp", price: 40, stock: 3, image });
    expect(created.status).toBe(201);
    expect(created.body.image).toBe(image);

    const updated = await request(app).put(`/products/${created.body._id}`).send({ image: "" });
    expect(updated.status).toBe(200);
    expect(updated.body.image).toBe("");
  });

  it("rejects an invalid image value", async () => {
    const response = await request(app).post("/products").send({ name: "Lamp", price: 40, stock: 3, image: "javascript:alert(1)" });
    expect(response.status).toBe(400);
  });

  it("deletes a product", async () => {
    const created = await request(app).post("/products").send({ name: "Lamp", price: 40, stock: 3 });
    const removed = await request(app).delete(`/products/${created.body._id}`);
    expect(removed.status).toBe(204);
    const missing = await request(app).get(`/products/${created.body._id}`);
    expect(missing.status).toBe(404);
  });
});
