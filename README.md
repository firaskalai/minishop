# MiniShop Microservices

MiniShop is a small e-commerce backend built to demonstrate microservices architecture with Node.js, Express, MongoDB, Docker, Docker Compose, Jest, Supertest, and GitHub Actions.

The application is split into independently running services:

- **API Gateway**: the public entry point on port `4000`.
- **Product Service**: manages the product catalog on port `4001`.
- **Order Service**: creates and reads orders on port `4002`.
- **Auth Service**: registers users, issues JWTs, and manages `USER`/`ADMIN` roles on port `4003`.
- **MongoDB**: stores products and orders in separate logical databases.

## 1. Architecture

```text
Client
	|
	v
API Gateway :4000
	|--------------------|
	v                    v
Product Service :4001  Order Service :4002  Auth Service :4003
	|                    |
	v                    v
minishop_products      minishop_orders
					\            /
						 MongoDB :27017
```

The browser or frontend only needs to know the gateway URL. Internal service URLs are configured with environment variables and are used inside the Docker network.

The Order Service does not access the Product Service database directly. When an order is created, it calls the Product Service HTTP API, retrieves the current product name and price, calculates the total on the server, and stores a snapshot of that name and price in the order.

## 2. Project Structure

```text
minishop-microservices/
|-- api-gateway/
|   |-- Dockerfile
|   |-- package.json
|   |-- package-lock.json
|   |-- src/index.js
|   `-- tests/gateway.test.js
|-- order-service/
|   |-- Dockerfile
|   |-- package.json
|   |-- package-lock.json
|   |-- src/index.js
|   `-- tests/order.test.js
|-- product-service/
|   |-- Dockerfile
|   |-- package.json
|   |-- package-lock.json
|   |-- src/index.js
|   `-- tests/product.test.js
|-- .github/workflows/ci.yml
|-- docker-compose.yml
`-- README.md
```

## 3. Prerequisites

Install Node.js 22 or another current Node.js LTS release, npm, Docker Desktop, and Git.

Verify the tools:

```bash
node --version
npm --version

docker compose version
```

On Windows, restart the VS Code terminal after installing Docker Desktop so the Docker CLI is added to `PATH`.

## 4. Run the Complete Application with Docker

From the repository root, build and start all containers:

```bash
docker compose up --build -d
```

Check the service status:

```bash
docker compose ps
```

The expected services are:

| Service | Host URL | Purpose |
| --- | --- | --- |
| API Gateway | `http://localhost:4000` | Public API entry point |
| Product Service | `http://localhost:4001` | Product API and health endpoint |
| Order Service | `http://localhost:4002` | Order API and health endpoint |
| Auth Service | `http://localhost:4003` | Authentication API and health endpoint |
| MongoDB | `mongodb://localhost:27017` | Persistent database |

The React storefront runs separately at `http://localhost:5173` during development and calls the API Gateway at `http://localhost:4000`.

The Compose file starts MongoDB first. Product Service waits for MongoDB to become healthy. Order Service waits for both MongoDB and Product Service. The API Gateway waits for Product Service and Order Service.

### Use MongoDB Atlas

For an Atlas deployment, copy `.env.example` to `.env` and set the two connection strings. Keep the product and order database names separate:

```text
PRODUCTS_MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/minishop_products?retryWrites=true&w=majority
ORDERS_MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/minishop_orders?retryWrites=true&w=majority
```

The `.env` file is ignored by Git. In MongoDB Atlas, add the machine's IP address to the project network access list and create a database user with access to the selected databases before starting Compose.

Stop the application:

```bash
docker compose down
```

Stop it and delete the MongoDB volume:

```bash
docker compose down -v
```

The `-v` option deletes the stored products and orders.

## 5. Check the Gateway

The root route describes the gateway:

```bash
curl http://localhost:4000/
```

Expected response:

```json
{
	"service": "api-gateway",
	"status": "ok",
	"endpoints": ["/health", "/api/products", "/api/orders"]
}
```

The health route is:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{
	"service": "api-gateway",
	"status": "ok"
}
```

## 6. Product API

All product requests should normally go through the gateway.

### List products

```bash
curl http://localhost:4000/api/products
```

### Create a product

```bash
curl -X POST http://localhost:4000/api/products \
	-H "Content-Type: application/json" \
	-d '{"name":"Laptop","description":"Work laptop","price":1200,"stock":10}'
```

The response contains the generated product `_id`. Save that value for the order request.

### Read one product

```bash
curl http://localhost:4000/api/products/PRODUCT_ID
```

Product validation rejects empty names, negative prices, non-numeric prices, negative stock, and non-integer stock values.

## 7. Order API

### Create an order

Replace `PRODUCT_ID` with an ID returned by the product endpoint:

```bash
curl -X POST http://localhost:4000/api/orders \
	-H "Content-Type: application/json" \
	-d '{"items":[{"productId":"PRODUCT_ID","quantity":2}]}'
```

The client sends only product IDs and quantities. The server obtains the product name and price through Product Service and calculates:

```text
total = sum(product price * requested quantity)
```

The response contains item snapshots, the server-calculated `total`, the initial `PENDING` status, timestamps, and the order ID.

### List orders

```bash
curl http://localhost:4000/api/orders
```

### Read one order

```bash
curl http://localhost:4000/api/orders/ORDER_ID
```

An order referencing a missing product returns an error. If Product Service is unavailable, Order Service returns `503` instead of creating an incomplete order.

## 8. How the Implementation Works

### Product Service

`product-service/src/index.js` creates an Express application, defines a Mongoose `Product` model, validates product data, provides product and health routes, and connects to `MONGODB_URI` when started as a real service.

### Order Service

`order-service/src/index.js` defines an `Order` model, validates IDs and quantities, calls `PRODUCT_SERVICE_URL/products/:id`, ignores client-supplied prices, calculates the total, and stores product name and price snapshots.

### API Gateway

`api-gateway/src/index.js` exposes port `4000`, rewrites `/api/products` to `/products`, rewrites `/api/orders` to `/orders`, forwards JSON requests, preserves backend status codes, and returns `503 Backend service unavailable` when a backend cannot be reached.

## 9. Docker Configuration

Each service has its own Dockerfile. Each image uses `node:22-alpine`, copies the package manifests, runs `npm ci --omit=dev`, copies the source, and starts the service with Node.js.

Docker Compose adds one MongoDB 7 container, separate product and order databases, a persistent `mongo_data` volume, internal service URLs, health checks, and health-gated startup ordering.

## 10. Run Tests Locally Without Docker

Install and test each service separately:

```bash
cd product-service
npm install
npm test

cd ../order-service
npm install
npm test

cd ../api-gateway
npm install
npm test
```

Product tests cover creation, listing, invalid data, and unknown IDs. Order tests cover creation, nonexistent products, and total calculation. Gateway tests cover the root route, health route, path rewriting, and backend unavailability.

Product and order tests use `mongodb-memory-server` for an isolated test database. The first run may need to download a MongoDB test binary.

## 11. Frontend

The `frontend/` directory contains the Vite React storefront. It is connected to the gateway through `VITE_API_URL`, which defaults to `http://localhost:4000`.

Start the frontend while the Docker backend is running:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in a browser. The storefront provides:

- Live product catalog loaded from Product Service through the gateway.
- Basket drawer with quantity controls and a calculated total.
- Order submission through Order Service.
- Product publishing form for creating catalog entries.
- Loading, empty, success, and backend error states.
- Responsive layout for desktop and mobile screens.

To use another gateway URL, create `frontend/.env`:

```text
VITE_API_URL=http://localhost:4000
```

Build the frontend for production:

```bash
cd frontend
npm run build
```

## 12. Continuous Integration

`.github/workflows/ci.yml` runs on pushes to `main` and pull requests targeting `main`.

For each service, GitHub Actions checks out the repository, installs Node.js 22, runs `npm ci`, runs `npm test`, and builds the Docker image.

After all service jobs pass, an integration job starts the Compose stack, checks the gateway health endpoint, checks the public product route, and removes the stack.

## 13. Troubleshooting

### Docker command not found

Restart the VS Code terminal after installing Docker Desktop. On a per-user Windows installation, the CLI is usually located at:

```text
C:\Users\YOUR_USER\AppData\Local\Programs\DockerDesktop\resources\bin
```

Make sure that directory is included in the Windows `PATH`.

### Port already in use

Check which process is using ports `4000`, `4001`, `4002`, or `27017`, then stop it or change the published ports in `docker-compose.yml`.

### Containers are unhealthy

Read the service logs:

```bash
docker compose logs mongo
docker compose logs product-service
docker compose logs order-service
docker compose logs api-gateway
```

### Reset the local database

```bash
docker compose down -v
docker compose up --build -d
```

## 14. What Was Completed

- Product Service REST API
- Order Service REST API
- API Gateway and route rewriting
- Server-side order total calculation
- Product price snapshots in orders
- Separate product and order MongoDB databases
- Dockerfiles for all services
- Docker Compose orchestration
- Persistent MongoDB volume
- Container health checks and startup dependencies
- Jest and Supertest test suites
- GitHub Actions unit, build, and integration workflow
- Local end-to-end product and order flow through the gateway
- React storefront connected to the gateway
- Basket and order checkout flow
- Frontend product creation flow

Cloud deployment is not included because it requires a hosting account, a managed MongoDB connection string, and provider-specific secrets. The containers are ready to deploy to a Docker-compatible host once those values are configured.

## 15. Useful Commands

```bash
# Start the stack
docker compose up --build -d

# View status
docker compose ps

# Follow logs
docker compose logs -f

# Stop services
docker compose down

# Rebuild after source changes
docker compose up --build -d

# Run gateway tests
cd api-gateway
npm test

# Start the frontend
cd ../frontend
npm run dev
```

## Admin account, product photos and basket

- On startup the auth service creates (or promotes) the admin account defined by `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` (defaults in `docker-compose.yml` and `.env.example`). Change the password before any real deployment.
- Admins can add products with a photo (upload or URL), change a product's photo and delete products from the storefront. The gateway restricts `POST`, `PUT` and `DELETE` on `/api/products` to the `ADMIN` role.
- The basket is saved in `localStorage`, capped by product stock, and re-synchronised with the catalog on load.

## Admin order dashboard

Sign in as an admin and click **Order dashboard** in the header. It shows order statistics, a filterable/searchable/sortable/paginated order table, order details, **Accept**, and **Decline** (a reason of 1–500 characters is required and is validated again by the Order Service).

| Endpoint (via the gateway) | Who | Purpose |
| --- | --- | --- |
| `GET /api/orders/stats` | ADMIN | Counts per status and confirmed sales value |
| `GET /api/orders/manage?status=&q=&sort=&page=&limit=` | ADMIN | Filtered, paginated list for the dashboard |
| `PATCH /api/orders/:id/accept` | ADMIN | `PENDING` → `CONFIRMED` |
| `PATCH /api/orders/:id/reject` | ADMIN | `PENDING` → `REJECTED`, body `{"reason": "..."}` |

Notes:

- Transitions use one atomic `findOneAndUpdate` filtered on `status: "PENDING"`, so concurrent requests cannot both succeed; the loser receives `409`.
- The gateway verifies the JWT, enforces the `ADMIN` role and forwards the verified identity (`x-user-*` headers) to the Order Service, which also checks the role. Client-supplied identity headers are never forwarded. Port 4002 is published by Compose, so do not expose it publicly.
- No database changes: the new order fields (`customer`, `rejectionReason`, `rejectedAt`, `rejectedBy`, `confirmedAt`, `confirmedBy`, `statusHistory`) are optional, so existing orders keep working. Orders created before this change show "Unknown customer".
- The project has no stock reservation or deduction, so accepting or rejecting does not change product stock.
