import { useState } from "react";

// Kadam components, built with: kadam build <project> --target web-components
import "./kadam-panel/kadam-elements.js";
import type {} from "./kadam-panel/kadam-elements.react.js";
import "./kadam-shop/kadam-elements.js";
import type {} from "./kadam-shop/kadam-elements.react.js";

const PRODUCTS = [
  { name: "Lamp", price: "40", link: "https://example.com/lamp" },
  { name: "Desk", price: "250", link: "https://example.com/desk" },
];

export function App() {
  const [title, setTitle] = useState("Welcome");
  const [picks, setPicks] = useState(0);
  const [compact, setCompact] = useState(false);

  return (
    <main>
      <h1>React app with Kadam components</h1>
      <label>
        Panel title{" "}
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <button type="button" onClick={() => setCompact((value) => !value)}>
        Toggle compact
      </button>
      <p id="picks">Picked {picks} times</p>

      <kadam-panel title={title} variant={compact ? "compact" : "default"} onpick={() => setPicks((count) => count + 1)}>
        <p>React content in the slot</p>
        <p slot="footer">React footer</p>
      </kadam-panel>

      <section aria-label="Products">
        {PRODUCTS.map((product) => (
          <kadam-product-card key={product.name} name={product.name} price={product.price} link={product.link} />
        ))}
      </section>
    </main>
  );
}
