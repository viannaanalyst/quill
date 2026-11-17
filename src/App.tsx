import { lazy, Suspense, useState } from "react";
import { devParams } from "./lib/platform";
import { getPref, setPref } from "./lib/storage";
import { navigate, type View } from "./state/store";

// Cada parte grande carrega só quando é usada (o onboarding só aparece na primeira vez).
const Onboarding = lazy(() => import("./onboarding/Onboarding"));
const AppShell = lazy(() => import("./shell/AppShell"));

// Prévia: ?preload=onboarding carrega o onboarding junto, para pegar estilos que vazam entre telas.
if (devParams.get("preload") === "onboarding") void import("./onboarding/Onboarding");

// Prévia: ?screen=inbox|read|compose|day|week|month|settings abre direto numa tela.
const DEV_VIEWS: Record<string, View> = {
  inbox: { name: "inbox", folder: "inbox" },
  read: { name: "read", id: "m1" },
  compose: { name: "compose" },
  day: { name: "calendar", mode: "day" },
  week: { name: "calendar", mode: "week" },
  month: { name: "calendar", mode: "month" },
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

  return (
    <Suspense fallback={null}>
      {screen === "onboarding" ? (
        <Onboarding onDone={() => setScreen("app")} />
      ) : (
        <AppShell
          onRestartOnboarding={() => {
            setPref("onboarded", false);
            setScreen("onboarding");
          }}
        />
      )}
    </Suspense>
  );
}
