import { useEffect, useRef } from "react";

export function InfoModal({ modal, closeModal }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!modal) return undefined;
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modal, closeModal]);

  if (!modal) return null;

  return (
    <div className="info-modal fixed inset-0 grid place-items-center" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeModal();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby={`${modal.id}-title`}>
        <button className="modal-close" type="button" aria-label="Close" onClick={closeModal} ref={closeButtonRef}>×</button>
        <p className="modal-kicker">{modal.kicker}</p>
        <h2 id={`${modal.id}-title`}>{modal.title}</h2>
        <p>{modal.body}</p>
      </section>
    </div>
  );
}
