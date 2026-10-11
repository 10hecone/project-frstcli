#!/usr/bin/env node
"use strict";

// dotenv doit être chargé AVANT les modules qui lisent process.env.
try {
    require("dotenv").config();
} catch {
    // dotenv absent : les variables doivent alors venir de l'environnement
}

const { run } = require("./src/main");

run();
