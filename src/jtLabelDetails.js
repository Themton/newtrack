// Only show routing data actually returned by J&T. The order's service type
// is supplied by our create request; pickup and other depot codes are not.
export function jtLabelDetails(parcel, response = {}) {
  const data = response && typeof response === "object" ? response : {};
  return {
    sortingCode: data.sortingCode || parcel.flash_sort_code || "",
    secondaryCode: data.thirdSortingCode || data.streetSortingNo || "",
    lineCode: data.sortingLineCode || data.lineCode || "",
    expressType: "EZ",
    orderNo: data.txlogisticId || parcel.parcel_no || "",
    weight: Number(parcel.weight) > 0 ? Number(parcel.weight) : null,
    quantity: Number(parcel.quantity) > 0 ? Number(parcel.quantity) : null,
    remark: parcel.remark || "",
  };
}
