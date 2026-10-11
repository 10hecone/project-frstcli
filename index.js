#!/usr/bin/env node
"use strict";

try {
    require("dotenv").config();
} catch {
}

const { run } = require("./src/main");

run();
