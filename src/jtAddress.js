// Normalize only the J&T request, never rewrite saved addresses or Flash data.
export function jtAddress(parcel, prefix) {
  const value = key => String(parcel[`${prefix}_${key}`] ?? "").trim();
  const province = value("province").replace(/^(?:จังหวัด|จ\.)\s*/, "");
  const bangkok = ["กรุงเทพ", "กรุงเทพฯ", "กรุงเทพมหานคร", "กทม", "กทม."].includes(province);
  return {
    name: value("name"), mobile: value("phone"),
    postCode: value("postal"),
    prov: bangkok ? "กรุงเทพมหานคร" : province,
    city: value("district").replace(/^(?:อำเภอ|อ\.|เขต)\s*/, ""),
    area: value("subdistrict").replace(/^(?:ตำบล|ต\.|แขวง)\s*/, ""),
    address: value("address"), countryCode: "THA",
  };
}
