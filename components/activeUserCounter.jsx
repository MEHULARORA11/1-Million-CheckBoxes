export default function ActiveUsers({ count}) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "10px 18px",
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      fontFamily: "var(--font-sans)",
    }}>
      {/* Pulsing dot */}
      <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
        <span style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: "#1D9E75", opacity: 0.3,
          animation: "ping 1.6s ease-out infinite",
        }} />
        <span style={{
          position: "absolute", inset: 2, borderRadius: "50%",
          background: "#1D9E75",
        }} />
      </div>

      <span style={{ fontSize: 20, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
        {count.toLocaleString()}
      </span>

      <div style={{ width: "0.5px", height: 20, background: "var(--color-border-tertiary)" }} />

      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        active users
      </span>
    </div>
  );
}