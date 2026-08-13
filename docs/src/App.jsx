import { useCallback, useMemo, useState } from "react";
import { Demo } from "./components/Demo";
import { Header } from "./components/Header";
import { HeroCopy } from "./components/HeroCopy";
import { InfoModal } from "./components/InfoModal";

const MODALS = {
  compatibility: {
    kicker: "Before the first swivel",
    title: "One boring but important paragraph.",
    body: "Swivel needs a 64-bit desktop edition with display-rotation support and the .NET 8 Desktop Runtime. Some kiosk-style editions cannot expose the side reader. The app is unsigned, so your system may ask for confirmation before it runs.",
  },
  background: {
    kicker: "Quietly useful",
    title: "It lives in the tray.",
    body: "Close Settings and Swivel slips into the notification area, where tiny useful apps belong. On a regular monitor, one left-click on the tray icon rotates the selected display. On a supported rotating touchscreen, hold the blue button for two seconds whenever you need Settings. No service. No account. No telemetry.",
  },
  privacy: {
    kicker: "Privacy",
    title: "Your screen stays your business.",
    body: "Swivel has no accounts, analytics, advertising, or telemetry. App settings and diagnostics stay on your PC. GitHub and PayPal handle their own data when you use their links.",
  },
  terms: {
    kicker: "Terms",
    title: "Free software. Use your judgment.",
    body: "Swivel is provided as is, without warranties. You are responsible for testing display changes on your device. Swivel is independent software and is not affiliated with or endorsed by any hardware or stand manufacturer.",
  },
};

export default function App() {
  const [activeModal, setActiveModal] = useState(null);
  const openModal = useCallback((id) => setActiveModal(id), []);
  const closeModal = useCallback(() => setActiveModal(null), []);
  const modal = useMemo(
    () => activeModal ? { id: activeModal, ...MODALS[activeModal] } : null,
    [activeModal],
  );

  return (
    <>
      <main className="page-shell grid h-svh w-full">
        <section className="hero grid min-h-0 min-w-0 items-center" aria-labelledby="hero-title">
          <HeroCopy openModal={openModal} />
          <Demo header={<Header />} />
        </section>
      </main>
      <InfoModal modal={modal} closeModal={closeModal} />
    </>
  );
}
