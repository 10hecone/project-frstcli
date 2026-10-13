"use strict";

const { randomBytes } = require("node:crypto");

const newId = () => Date.now().toString(36) + randomBytes(3).toString("hex");

function requireString(value, name) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${name} doit être une chaîne non vide.`);
    }
    return value;
}

const optionalString = (value, name) => {
    if (value !== undefined) requireString(value, name);
};

const optionalInt = (value, name) => {
    if (value !== undefined && !Number.isInteger(value)) {
        throw new Error(`${name} doit être un entier.`);
    }
};

const optionalBool = (value, name) => {
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error(`${name} doit être un booléen.`);
    }
};

module.exports = { newId, requireString, optionalString, optionalInt, optionalBool };
