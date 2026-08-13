import { useCallback, useMemo, useState } from "react";
import { Demo } from "./components/Demo";
import { Header } from "./components/Header";
import { HeroCopy } from "./components/HeroCopy";
import { InfoModal } from "./components/InfoModal";

const MODALS = {
  compatibility: {
    kicker: "Before the first swivel",
    title: "One boring but important paragraph.",
    body: "Swivel needs Windows 10/11 Pro or Enterprise. Windows 10 Team cannot use the fingerprint reader. The app is unsigned, so Windows may ask whether you are sure. You are still in charge of that decision.",
  },
  background: {
    kicker: "Quietly useful",
    title: "It lives in the tray.",
    body: "Close Settings and Swivel slips into the notification area, where tiny useful apps belong. On a regular monitor, one left-click on the tray icon rotates the selected display. On a Surface Hub, hold the blue button for two seconds whenever you need Settings. No service. No account. No telemetry.",
  },
  privacy: {
    kicker: "Privacy",
    title: "Your screen stays your business.",
    body: "Swivel has no accounts, analytics, advertising, or telemetry. App settings and diagnostics stay on your PC. GitHub and PayPal handle their own data when you use their links.",
  },
  terms: {
    kicker: "Terms",
    title: "Free software. Use your judgment.",
    body: "Swivel is provided as is, without warranties. You are responsible for testing display changes on your device. Swivel is not affiliated with or endorsed by Microsoft or Steelcase.",
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
      <main className="page-shell mx-auto grid h-svh w-full">
        <Header />
        <section className="hero grid min-h-0 min-w-0 items-center" aria-labelledby="hero-title">
          <HeroCopy openModal={openModal} />
          <Demo />
        </section>
      </main>
      <InfoModal modal={modal} closeModal={closeModal} />
    </>
  );
}
