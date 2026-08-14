import { useEffect, useRef } from "react";

export function InfoModal({ modal, closeModal }) {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const invokingElementRef = useRef(null);

  useEffect(() => {
    if (!modal) return undefined;

    invokingElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const pageShell = document.querySelector(".page-shell");
    const pageWasInert = pageShell?.hasAttribute("inert") ?? false;
    pageShell?.setAttribute("inert", "");
    closeButtonRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (pageShell && !pageWasInert) pageShell.removeAttribute("inert");
      const invokingElement = invokingElementRef.current;
      if (invokingElement?.isConnected) invokingElement.focus({ preventScroll: true });
    };
  }, [modal, closeModal]);

  if (!modal) return null;

  return (
    <div className="info-modal fixed inset-0 grid place-items-center" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeModal();
    }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${modal.id}-title`} tabIndex={-1}>
        <button className="modal-close" type="button" aria-label="Close" onClick={closeModal} ref={closeButtonRef}>×</button>
        <p className="modal-kicker">{modal.kicker}</p>
        <h2 id={`${modal.id}-title`}>{modal.title}</h2>
        <p>{modal.body}</p>
      </section>
    </div>
  );
}
