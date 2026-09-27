import { createRoot } from "react-dom/client";
import { loadDeployment } from "./config";
import App from "./App";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="boot">
    <p className="eyebrow">Points / lab</p>
    <h1>Opening the experiment…</h1>
    <p role="status">Verifying deployment configuration and ABI hashes.</p>
  </main>,
);
loadDeployment()
  .then((config) => root.render(<App config={config} />))
  .catch((error) =>
    root.render(
      <main className="boot">
        <p className="eyebrow">Points / lab</p>
        <h1>Unable to load the deployment</h1>
        <p role="alert">{error.message}</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload deployment
        </button>
      </main>,
    ),
  );
