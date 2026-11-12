import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QR({ url, size = 320 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#05060aff", light: "#ffffffff" } }).then(setSvg);
  }, [url]);
  return (
    <div
      className="rounded-2xl bg-white p-4 shadow-[0_0_80px_-10px_rgba(124,92,255,0.8)]"
      style={{ width: size, height: size }}
      aria-label={`QR code for ${url}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
