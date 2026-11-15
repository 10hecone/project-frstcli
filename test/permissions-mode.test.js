"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const permissionsMode = require("../src/core/permissions-mode");

test("permissionsMode : default au départ, casse ignorée, mode inconnu refusé", () => {
    try {
        assert.equal(permissionsMode.get(), "default");
        assert.equal(permissionsMode.acceptsEdits(), false);
        assert.equal(permissionsMode.readOnly(), false);

        assert.equal(permissionsMode.set("ACCEPTEDITS"), "acceptEdits");
        assert.equal(permissionsMode.acceptsEdits(), true);
        assert.equal(permissionsMode.readOnly(), false);

        assert.equal(permissionsMode.set("plan"), "plan");
        assert.equal(permissionsMode.acceptsEdits(), false);
        assert.equal(permissionsMode.readOnly(), true);

        assert.equal(permissionsMode.set("chat"), null);
        assert.equal(permissionsMode.set(undefined), null);
        assert.equal(permissionsMode.get(), "plan");
    } finally {
        permissionsMode.set("default");
    }
});
