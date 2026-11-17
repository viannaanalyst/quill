import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/components.css";
import App from "./App";
import { applyDevTheme, applyPlatformClass, applyTheme, type ThemePref } from "./lib/platform";
import { getPref } from "./lib/storage";
import { loadMailbox, startAutoRefresh } from "./state/mailbox";

applyTheme(getPref<ThemePref>("theme", "system"));
applyDevTheme();
applyPlatformClass();
// no app: busca as contas conectadas e os e-mails assim que abre (na prévia não faz nada)
void loadMailbox();
// e confere e-mails novos a cada 3 minutos enquanto a janela está à vista
startAutoRefresh(3);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
