import { jtPickupStatus } from './jtPickupStatus.js';

export function hasConfirmedJtPickup(parcel) {
  if (parcel.source !== 'jnt') return false;
  try {
    return jtPickupStatus({ code: 1, data: { traces: [{
      scanType: parcel.flash_status, scanTime: parcel.flash_updated_at,
    }] } }) === 'received';
  } catch {
    return false;
  }
}
