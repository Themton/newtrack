export const shopCarrierKey = shop => shop?.carrier === "jnt" ? "jnt" : "flash";

export function otherCarrierDefaults(shops, target) {
  return shops.filter(shop => shop.id !== target.id && shop.is_default && shopCarrierKey(shop) === shopCarrierKey(target));
}

export function hasCarrierDefault(shops, carrier) {
  return shops.some(shop => shop.is_active && shop.is_default && shopCarrierKey(shop) === carrier);
}
