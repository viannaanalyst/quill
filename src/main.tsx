import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/components.css";
import App from "./App";
import { applyDevTheme, applyPlatformClass } from "./lib/platform";
import { loadMailbox } from "./state/mailbox";

applyDevTheme();
applyPlatformClass();
// no app: busca as contas conectadas e os e-mails assim que abre (na prévia não faz nada)
void loadMailbox();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
