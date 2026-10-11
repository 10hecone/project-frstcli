"use strict";

const { c } = require("../cli/ui");

/**
 * Diff ligne à ligne. On retire d'abord le préfixe et le suffixe communs
 * pour que la LCS ne porte que sur la zone modifiée.
 */
function diffLines(oldText, newText) {
    const a = oldText.split("\n");
    const b = newText.split("\n");

    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;

    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }

    const ops = [];

    for (let i = 0; i < start; i++) {
        ops.push({ t: " ", s: a[i], o: i + 1, n: i + 1 });
    }

    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const n = midA.length;
    const m = midB.length;

    if (n * m > 4_000_000) {
        midA.forEach((s, i) => ops.push({ t: "-", s, o: start + i + 1 }));
        midB.forEach((s, j) => ops.push({ t: "+", s, n: start + j + 1 }));
    } else {
        const W = m + 1;
        const dp = new Uint32Array((n + 1) * W);

        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i * W + j] =
                    midA[i] === midB[j]
                        ? dp[(i + 1) * W + j + 1] + 1
                        : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
            }
        }

        let i = 0;
        let j = 0;

        while (i < n && j < m) {
            if (midA[i] === midB[j]) {
                ops.push({ t: " ", s: midA[i], o: start + i + 1, n: start + j + 1 });
                i++; j++;
            } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
                ops.push({ t: "-", s: midA[i], o: start + i + 1 });
                i++;
            } else {
                ops.push({ t: "+", s: midB[j], n: start + j + 1 });
                j++;
            }
        }

        while (i < n) { ops.push({ t: "-", s: midA[i], o: start + i + 1 }); i++; }
        while (j < m) { ops.push({ t: "+", s: midB[j], n: start + j + 1 }); j++; }
    }

    for (let k = endA; k < a.length; k++) {
        ops.push({ t: " ", s: a[k], o: k + 1, n: endB + (k - endA) + 1 });
    }

    return ops;
}

function countChanges(ops) {
    return {
        added: ops.filter(op => op.t === "+").length,
        removed: ops.filter(op => op.t === "-").length
    };
}

const clean = s => String(s).replace(/\r$/, "");

/**
 * Affiche un diff façon Claude Code (2 lignes de contexte, "⋮" entre
 * les blocs). oldText = null : création, tout est affiché en vert.
 * Renvoie { added, removed }.
 */
function printDiff(oldText, newText, maxLines = 60) {
    if (oldText === null) {
        const lines = newText.split("\n");

        lines.slice(0, maxLines).forEach((line, i) => {
            console.log(
                `    ${c.gray(String(i + 1).padStart(4))} ${c.green(`+ ${clean(line)}`)}`
            );
        });

        if (lines.length > maxLines) {
            console.log(c.dim(`    … ${lines.length - maxLines} lignes de plus`));
        }

        return { added: lines.length, removed: 0 };
    }

    const ops = diffLines(oldText, newText);
    const CONTEXT = 2;
    const keep = new Array(ops.length).fill(false);

    ops.forEach((op, idx) => {
        if (op.t === " ") return;

        for (
            let k = Math.max(0, idx - CONTEXT);
            k <= Math.min(ops.length - 1, idx + CONTEXT);
            k++
        ) {
            keep[k] = true;
        }
    });

    let printed = 0;
    let skipped = false;
    let hidden = 0;

    ops.forEach((op, idx) => {
        if (!keep[idx]) {
            skipped = true;
            return;
        }

        if (printed >= maxLines) {
            hidden++;
            return;
        }

        if (skipped && printed > 0) console.log(c.gray("    ⋮"));

        skipped = false;
        printed++;

        const num = String(op.n ?? op.o).padStart(4);
        const text = clean(op.s);

        if (op.t === "+") console.log(`    ${c.gray(num)} ${c.green(`+ ${text}`)}`);
        else if (op.t === "-") console.log(`    ${c.gray(num)} ${c.red(`- ${text}`)}`);
        else console.log(`    ${c.gray(num)} ${c.dim(`  ${text}`)}`);
    });

    if (hidden) console.log(c.dim(`    … ${hidden} lignes de diff supplémentaires`));

    return countChanges(ops);
}

module.exports = { diffLines, countChanges, printDiff };
