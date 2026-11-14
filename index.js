#!/usr/bin/env node
"use strict";

try {
    require("dotenv").config({ quiet: true });
} catch {
}

const { run } = require("./src/main");

run();
