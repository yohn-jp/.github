#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const version_1 = require("./version");
function main(argv) {
    if (argv.includes("--version") || argv.includes("-v")) {
        console.log(version_1.version);
        return;
    }
    console.log("ts-cli-fixture: a minimal fixture CLI used to self-test yohn-jp/.github's reusable TypeScript CLI CI workflow.");
}
main(process.argv.slice(2));
