import { encode, QrCodeDataType } from "uqr";

const QUIET_ZONE = 4;
const MODULE_RADIUS = 0.42;

// Paper-plane path from Logo.svg in Telegram's public logo pack:
// https://telegram.org/tour/screenshots#logos
const TELEGRAM_PLANE = "M226.328419,494.722069 C372.088573,431.216685 469.284839,389.350049 517.917216,369.122161 C656.772535,311.36743 685.625481,301.334815 704.431427,301.003532 C708.567621,300.93067 717.815839,301.955743 723.806446,306.816707 C728.864797,310.92121 730.256552,316.46581 730.922551,320.357329 C731.588551,324.248848 732.417879,333.113828 731.758626,340.040666 C724.234007,419.102486 691.675104,610.964674 675.110982,699.515267 C668.10208,736.984342 654.301336,749.547532 640.940618,750.777006 C611.904684,753.448938 589.856115,731.588035 561.733393,713.153237 C517.726886,684.306416 492.866009,666.349181 450.150074,638.200013 C400.78442,605.66878 432.786119,587.789048 460.919462,558.568563 C468.282091,550.921423 596.21508,434.556479 598.691227,424.000355 C599.00091,422.680135 599.288312,417.758981 596.36474,415.160431 C593.441168,412.561881 589.126229,413.450484 586.012448,414.157198 C581.598758,415.158943 511.297793,461.625274 375.109553,553.556189 C355.154858,567.258623 337.080515,573.934908 320.886524,573.585046 C303.033948,573.199351 268.692754,563.490928 243.163606,555.192408 C211.851067,545.013936 186.964484,539.632504 189.131547,522.346309 C190.260287,513.342589 202.659244,504.134509 226.328419,494.722069 Z";

type DarkModule = (x: number, y: number) => boolean;

function modulePath(x: number, y: number, dark: DarkModule): string {
  const top = dark(x, y - 1);
  const right = dark(x + 1, y);
  const bottom = dark(x, y + 1);
  const left = dark(x - 1, y);
  const topLeft = top || left ? 0 : MODULE_RADIUS;
  const topRight = top || right ? 0 : MODULE_RADIUS;
  const bottomRight = bottom || right ? 0 : MODULE_RADIUS;
  const bottomLeft = bottom || left ? 0 : MODULE_RADIUS;

  return [
    `M${x + topLeft} ${y}H${x + 1 - topRight}`,
    topRight ? `Q${x + 1} ${y} ${x + 1} ${y + topRight}` : "",
    `V${y + 1 - bottomRight}`,
    bottomRight ? `Q${x + 1} ${y + 1} ${x + 1 - bottomRight} ${y + 1}` : "",
    `H${x + bottomLeft}`,
    bottomLeft ? `Q${x} ${y + 1} ${x} ${y + 1 - bottomLeft}` : "",
    `V${y + topLeft}`,
    topLeft ? `Q${x} ${y} ${x + topLeft} ${y}` : "",
    "Z",
  ].join("");
}

function insetCorners(x: number, y: number, dark: DarkModule): string[] {
  const corners: string[] = [];
  for (const dx of [-1, 1]) {
    for (const dy of [-1, 1]) {
      if (dark(x + dx, y) && dark(x, y + dy) && dark(x + dx, y + dy)) {
        const cornerX = dx < 0 ? x : x + 1;
        const cornerY = dy < 0 ? y : y + 1;
        corners.push(
          `M${cornerX} ${cornerY}h${-dx * MODULE_RADIUS}` +
            `Q${cornerX} ${cornerY} ${cornerX} ${cornerY - dy * MODULE_RADIUS}Z`,
        );
      }
    }
  }
  return corners;
}

function finder(x: number, y: number): string {
  return (
    `<rect x="${x}" y="${y}" width="7" height="7" rx="1.75"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.12" fill="#fff"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".68"/>`
  );
}

export function renderTelegramQr(link: string): string {
  // High error correction leaves room for the centered mark.
  const { data, size, types } = encode(link, { ecc: "H", border: 0 });
  const centerModule = Math.floor(size / 2);
  const logoRadius = Math.floor(size / 9) - 0.05;
  const logoDiameter = logoRadius * 2;
  const logoCenter = size / 2;
  const side = size + QUIET_ZONE * 2;

  // Clear cells touching the logo's circular white space, keeping data in the corners.
  const logoClearance = (logoRadius + 0.26) ** 2;
  const visible = data.map((row, y) => row.map((cell, x) => {
    if (!cell || types[y][x] === QrCodeDataType.Position) return false;
    const dx = Math.max(0, Math.abs(x - centerModule) - 0.5);
    const dy = Math.max(0, Math.abs(y - centerModule) - 0.5);
    return dx * dx + dy * dy > logoClearance;
  }));
  const dark: DarkModule = (x, y) => visible[y]?.[x] ?? false;
  const modules: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (dark(x, y)) {
        modules.push(modulePath(x, y, dark));
      } else {
        modules.push(...insetCorners(x, y, dark));
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" role="img" aria-label="Telegram 봇 가입 QR 코드">
    <defs>
      <linearGradient id="telegram-qr-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${size}" y2="${size}">
        <stop stop-color="#6e61c5"/>
        <stop offset=".52" stop-color="#4173c5"/>
        <stop offset="1" stop-color="#2376af"/>
      </linearGradient>
    </defs>
    <rect width="${side}" height="${side}" fill="#fff"/>
    <g transform="translate(${QUIET_ZONE} ${QUIET_ZONE})" fill="url(#telegram-qr-ink)">
      <path d="${modules.join("")}"/>
      ${finder(0, 0)}${finder(size - 7, 0)}${finder(0, size - 7)}
      <circle cx="${logoCenter}" cy="${logoCenter}" r="${logoRadius}"/>
      <path data-telegram-logo="" transform="translate(${logoCenter - logoRadius} ${logoCenter - logoRadius}) scale(${logoDiameter / 1000})" fill="#fff" d="${TELEGRAM_PLANE}"/>
    </g>
  </svg>`;
}
