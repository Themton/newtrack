// Normalize only the J&T request, never rewrite saved addresses or Flash data.
export function jtAddress(parcel, prefix) {
  const value = key => String(parcel[`${prefix}_${key}`] ?? "").trim();
  const province = value("province").replace(/^(?:จังหวัด|จ\.)\s*/, "");
  const bangkok = ["กรุงเทพ", "กรุงเทพฯ", "กรุงเทพมหานคร", "กทม", "กทม."].includes(province);
  const city = value("district").replace(/^(?:อำเภอ|อ\.|เขต)\s*/, "");
  const area = value("subdistrict").replace(/^(?:ตำบล|ต\.|แขวง)\s*/, "");
  const detail = value("address");
  // Keep an empty street address empty so required-address validation still works.
  let address = detail;
  if (detail) {
    for (const [name, label, aliases] of [
      [area, bangkok ? "แขวง" : "ตำบล", "ตำบล|ต\\.|แขวง"],
      [city, bangkok ? "เขต" : "อำเภอ", "อำเภอ|อ\\.|เขต"],
    ]) {
      if (!name) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const present = new RegExp(`(?:${aliases})\\s*${escaped}(?=$|[\\s,]|ตำบล|อำเภอ|แขวง|เขต|จังหวัด|จ\\.)`);
      if (!present.test(address)) address += ` ${label}${name}`;
    }
  }
  return {
    name: value("name"), mobile: value("phone"),
    postCode: value("postal"),
    prov: bangkok ? "กรุงเทพมหานคร" : province,
    city, area,
    address, countryCode: "THA",
  };
}
