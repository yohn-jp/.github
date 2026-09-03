import usedPackage from "used-package";
import { used } from "./helper.js";

export function run(first, second, third) {
  if (first) {
    if (second) {
      return used(usedPackage(third));
    }
  }
  return 0;
}
