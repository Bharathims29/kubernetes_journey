import express from "express";
import mongoose from "mongoose";

const { PORT = 5000, MONGODB_URI, MONGODB_USERNAME, MONGODB_PASSWORD } = process.env;

const todoSchema = new mongoose.Schema(
  { text: { type: String, required: true, trim: true }, done: { type: Boolean, default: false } },
  { timestamps: true }
);
const Todo = mongoose.model("Todo", todoSchema);

await mongoose.connect(MONGODB_URI, {
  auth: MONGODB_USERNAME ? { username: MONGODB_USERNAME, password: MONGODB_PASSWORD } : undefined,
});

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: "ok" });
});

app.get("/api/todos", async (_req, res) => {
  res.json(await Todo.find().sort({ createdAt: -1 }));
});

app.post("/api/todos", async (req, res) => {
  if (!req.body.text?.trim()) return res.status(400).json({ error: "text is required" });
  res.status(201).json(await Todo.create({ text: req.body.text.trim() }));
});

app.patch("/api/todos/:id", async (req, res) => {
  const { text, done } = req.body;
  const todo = await Todo.findByIdAndUpdate(req.params.id, { text, done }, { new: true, omitUndefined: true });
  if (!todo) return res.status(404).json({ error: "not found" });
  res.json(todo);
});

app.delete("/api/todos/:id", async (req, res) => {
  const todo = await Todo.findByIdAndDelete(req.params.id);
  if (!todo) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.listen(PORT, () => console.log(`backend listening on ${PORT}`));
