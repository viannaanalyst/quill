import { lazy, Suspense, useState } from "react";
import { devParams } from "./lib/platform";
import { getPref, setPref } from "./lib/storage";

// Cada parte grande carrega só quando é usada (o onboarding só aparece na primeira vez).
const Onboarding = lazy(() => import("./onboarding/Onboarding"));
const AppShell = lazy(() => import("./shell/AppShell"));

function initialScreen(): "onboarding" | "app" {
  const forced = devParams.get("screen");
  if (forced === "inbox") return "app";
  if (forced === "onboarding" || devParams.has("step")) return "onboarding";
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
