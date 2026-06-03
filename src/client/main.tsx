import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./lib/toast";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
