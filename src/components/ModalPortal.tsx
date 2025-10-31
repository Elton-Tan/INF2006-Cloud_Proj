import { createPortal } from "react-dom";
import React from "react";

export default function ModalPortal({
  children,
}: {
  children: React.ReactNode;
}) {
  const [el] = React.useState(() => document.createElement("div"));
  React.useEffect(() => {
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, [el]);
  return createPortal(children, el);
}
