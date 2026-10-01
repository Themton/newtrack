import assert from "node:assert/strict";
import { jtLabelDetails } from "./jtLabelDetails.js";

const parcel = { flash_sort_code: "SORT", parcel_no: "MT-1", weight: 1.5, quantity: 2, remark: "ระวังแตก" };
assert.deepEqual(jtLabelDetails(parcel, { sortingCode: "JNT", thirdSortingCode: "DEPOT", txlogisticId: "JNT-1" }), {
  sortingCode: "JNT", secondaryCode: "DEPOT", lineCode: "", expressType: "EZ",
  orderNo: "JNT-1", weight: 1.5, quantity: 2, remark: "ระวังแตก",
});
assert.equal(jtLabelDetails(parcel).secondaryCode, "");
assert.equal(jtLabelDetails(parcel).orderNo, "MT-1");
console.log("J&T label details: passed");
