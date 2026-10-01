// Makes a TEST copy of the extension that also works on the mock CRM
// (http://localhost:4567), in mock-crm/test-extension/. Load that folder with
// "Load unpacked" to use the real popup against the mock. The real extension
// in chrome-extension/ is not changed.
//
// Run:   node mock-crm/make-test-extension.js
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "chrome-extension");
const OUT = path.join(__dirname, "test-extension");
const MOCK = `http://localhost:${Number(process.env.PORT) || 4567}/*`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

const manifestPath = path.join(OUT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
// ONLY the mock - the test copy can never touch the real CRM.
manifest.name = "FamFitHelper CRM Assist (TEST - mock CRM only)";
manifest.host_permissions = [MOCK];
manifest.content_scripts.forEach((cs) => { cs.matches = [MOCK]; });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Test extension written to ${OUT}`);
console.log(`It only works on the mock CRM (${MOCK.replace("/*", "")}), never on the real CRM.`);
console.log('Load it via chrome://extensions > Developer mode > "Load unpacked".');
