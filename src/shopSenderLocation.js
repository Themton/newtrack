import ADDR_DB from "./addr.js";

// Older shops store the full sender address in one field. Match it against the
// postcode database; the postcode alone is never enough to choose a subdistrict.
export function shopSenderLocation(shop) {
  const district = shop?.district || "";
  const subdistrict = shop?.subdistrict || "";
  if (district && subdistrict) return { district, subdistrict };

  const province = String(shop?.province || "").replace("กรุงเทพมหานคร", "กรุงเทพ");
  const matches = (ADDR_DB[String(shop?.postal || "")] || []).filter(a => !province || a.p === province);
  if (!matches.length) return { district, subdistrict };

  const rawTokens = String(shop?.address || "").split(/[\s,，]+/).filter(Boolean);
  const tokens = rawTokens.map(t => t.replace(/^(?:ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต)/, ""));
  const districts = [...new Set(matches.map(a => a.d))];
  const namedDistricts = districts.filter(d => tokens.includes(d));
  const inferredDistrict = district || (districts.length === 1 ? districts[0] : namedDistricts.length === 1 ? namedDistricts[0] : "");
  const candidates = matches.filter(a => !inferredDistrict || a.d === inferredDistrict);
  const inferredSubs = [...new Set(candidates.map(a => a.s))].filter(s => {
    const occurrences = tokens.filter(t => t === s).length;
    const explicitSubdistrict = rawTokens.some(t => /^(?:ตำบล|ต\.|แขวง)/.test(t) && t.replace(/^(?:ตำบล|ต\.|แขวง)/, "") === s);
    return explicitSubdistrict || occurrences > (s === inferredDistrict ? 1 : 0);
  });
  return { district: inferredDistrict, subdistrict: subdistrict || (inferredSubs.length === 1 ? inferredSubs[0] : "") };
}
