export function publicTrackingQuery(input) {
  let term = String(input || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  if (/^\+66\d{9}$/.test(term)) term = '0' + term.slice(3);
  if (!/^[A-Za-z0-9]{8,40}$/.test(term)) throw new Error('กรุณากรอกเลขพัสดุ หรือเบอร์โทรผู้รับให้ครบ ไม่ใช้สัญลักษณ์พิเศษ');
  const params = new URLSearchParams({
    and: '(or(source.is.null,source.neq.jnt_uat))',
    or: `(flash_pno.eq.${term},receiver_phone.eq.${term})`,
    select: 'source,flash_pno,receiver_name,receiver_province,receiver_district,flash_status,flash_detail,flash_updated_at,created_at,status',
    order: 'created_at.desc', limit: '20',
  });
  return params.toString();
}
