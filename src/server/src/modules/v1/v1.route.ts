import { Hono } from "hono";
import { requireApiKey } from "./api-key.middleware.js";
import datatablesV1 from "./v1-datatables.route.js";
import kvV1 from "./v1-kv.route.js";

const app = new Hono();

app.use("*", requireApiKey);

app.route("/datatables", datatablesV1);
app.route("/kv", kvV1);

export default app;
