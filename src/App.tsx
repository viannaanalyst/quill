import { lazy, Suspense, useState } from "react";
import { devParams, isTauri } from "./lib/platform";
import { LockScreen } from "./components/LockScreen";
import { getPref, setPref } from "./lib/storage";
import { navigate, type View } from "./state/store";
import { useMailbox } from "./state/mailbox";

// Cada parte grande carrega só quando é usada (o onboarding só aparece na primeira vez).
const Onboarding = lazy(() => import("./onboarding/Onboarding"));
const AppShell = lazy(() => import("./shell/AppShell"));

// Prévia: ?preload=onboarding carrega o onboarding junto, para pegar estilos que vazam entre telas.
if (devParams.get("preload") === "onboarding") void import("./onboarding/Onboarding");

// Prévia: ?screen=inbox|trash|read|compose|day|week|month|chat|settings abre direto numa tela
// (no Chat: &chat=none sem conta Workspace, &chat=rec gravando áudio, &chat=att enviando anexos).
const DEV_VIEWS: Record<string, View> = {
  inbox: { name: "inbox", folder: "inbox" },
  trash: { name: "inbox", folder: "trash" },
  read: { name: "read", id: "m1" },
  compose: { name: "compose" },
  day: { name: "calendar", mode: "day" },
  week: { name: "calendar", mode: "week" },
  month: { name: "calendar", mode: "month" },
  chat: { name: "chat" },
  settings: { name: "settings" },
};
const devView = DEV_VIEWS[devParams.get("screen") ?? ""];
if (devView) navigate(devView);

function initialScreen(): "onboarding" | "app" {
  if (devView) return "app";
  if (devParams.get("screen") === "onboarding" || devParams.has("step")) return "onboarding";
  return getPref("onboarded", false) ? "app" : "onboarding";
}

export default function App() {
  const [screen, setScreen] = useState(initialScreen);
  // Touch ID ligado em Ajustes → Privacidade: o app abre bloqueado (só no app de verdade)
  const [locked, setLocked] = useState(() => isTauri && getPref("touchId", false) && initialScreen() === "app");
  // "Rever o onboarding" nos Ajustes: mostra mesmo com conta conectada
  const [replay, setReplay] = useState(false);
  const hasAccount = useMailbox((s) => s.connected.length > 0);
  const loaded = useMailbox((s) => s.status === "ready");
  const [checked, setChecked] = useState(false);

  // ao abrir: se já tem conta neste computador, pula o onboarding (ele só volta pelos Ajustes).
  // Só na primeira carga, para não pular o passo final logo depois de entrar pelo onboarding.
  if (loaded && !checked) {
    setChecked(true);
    if (screen === "onboarding" && hasAccount && !replay && !devParams.has("step") && devParams.get("screen") !== "onboarding") {
      setPref("onboarded", true);
      setScreen("app");
    }
  }

  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  return (
    <Suspense fallback={null}>
      {screen === "onboarding" ? (
        <Onboarding
          onDone={() => {
            setReplay(false);
            setScreen("app");
          }}
        />
      ) : (
        <AppShell
          onRestartOnboarding={() => {
            setReplay(true);
            setScreen("onboarding");
          }}
        />
      )}
    </Suspense>
  );
}
