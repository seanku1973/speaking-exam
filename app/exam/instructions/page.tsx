/* PHASE10A_SUSPENSE_WRAPPER */
import { Suspense } from "react";
import PageClient from "./PageClient";

function LoadingFallback() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f8fafc",
        color: "#64748b",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 32,
            height: 32,
            margin: "0 auto 12px",
            border: "3px solid #dbe3ee",
            borderTopColor: "#2563eb",
            borderRadius: "50%",
          }}
        />
        <p style={{ margin: 0, fontSize: 14 }}>甇?頛...</p>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PageClient />
    </Suspense>
  );
}
