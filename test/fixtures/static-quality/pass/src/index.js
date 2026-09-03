import usedPackage from "used-package";
import { helper } from "./helper.js";

export function run(value) {
  return helper(usedPackage(value));
}
