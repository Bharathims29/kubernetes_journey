import { useEffect, useState } from "react";

export default function App() {
  const [todos, setTodos] = useState([]);
  const [text, setText] = useState("");

  const load = () =>
    fetch("/api/todos")
      .then((r) => r.json())
      .then(setTodos);

  useEffect(() => {
    load();
  }, []);

  const addTodo = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setText("");
    load();
  };

  const toggleDone = async (todo) => {
    await fetch(`/api/todos/${todo._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !todo.done }),
    });
    load();
  };

  const deleteTodo = async (id) => {
    await fetch(`/api/todos/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <main className="app">
      <h1>Todo List</h1>
      <form onSubmit={addTodo}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What needs to be done?"
        />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map((todo) => (
          <li key={todo._id} className={todo.done ? "done" : ""}>
            <label>
              <input type="checkbox" checked={todo.done} onChange={() => toggleDone(todo)} />
              {todo.text}
            </label>
            <button onClick={() => deleteTodo(todo._id)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
