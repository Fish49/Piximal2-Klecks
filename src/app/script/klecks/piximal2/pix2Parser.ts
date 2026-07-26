import { Piximal2 } from "./piximal2";

const sl_comment = /\/\/.*\n/g;
const ml_comment = /\/\*.*\*(\/)/gs;
const numberRE = /^[-+]?((0x[0-9a-fA-F_]+)|(0b[01_]+)|(0o[0-7_]+)|([0-9_]+))$/;
const floatRE = /^[+-]?[0-9]+\.[0-9]+(e[+-]?[0-9]+)?$/;
const ws = /\s+/g;

export let defaultKeywords: {[id: string]: BigInt} = {
    "p0":              0n          | (1n << 23n),
    "p1":              1n          | (1n << 23n),
    "pw":              2n          | (1n << 23n),
    "os":              3n          | (1n << 23n),
    "dref":            4n          | (1n << 23n),
    "im":              5n          | (1n << 23n),
    "wp":              6n          | (1n << 23n),
    "hp":              7n          | (1n << 23n),
    "npp":             8n          | (1n << 23n),
    "origin":          9n          | (1n << 23n),
    "dfc":             10n         | (1n << 23n),
    "ntp":             11n         | (1n << 23n),
    "thrp":            12n         | (1n << 23n),
    "stp":             13n         | (1n << 23n),
    "ins":             14n         | (1n << 23n),
    "rstp":            15n         | (1n << 23n),
    "arg":             16n         | (1n << 23n),
    "loc":             17n         | (1n << 23n),
    "thri":            18n         | (1n << 23n),
    "coord":           19n         | (1n << 23n),
    "funcorigin":      20n         | (1n << 23n),
    "funcos":          21n         | (1n << 23n),
    "cmt":             22n         | (1n << 23n),
    "stb":             23n         | (1n << 23n),
    "stt":             24n         | (1n << 23n),
    "reg":             25n         | (1n << 23n),
    "sti":             26n         | (1n << 23n),
    "rsti":            27n         | (1n << 23n),
    "addr":            28n         | (1n << 23n),

    "fp0":             512n        | (1n << 23n),
    "fpn0":            513n        | (1n << 23n),
    "inf":             514n        | (1n << 23n),
    "ninf":            515n        | (1n << 23n),
    "fp1":             516n        | (1n << 23n),
    "fpn1":            517n        | (1n << 23n),
    "largestsafeint":  518n        | (1n << 23n),
    "largestfinite":   519n        | (1n << 23n),
    "smallestnormal":  520n        | (1n << 23n),
    "pi":              521n        | (1n << 23n),
    "e":               522n        | (1n << 23n),
    "sqrt2":           523n        | (1n << 23n),
    "sqrt1_2":         524n        | (1n << 23n),
    "sqrt3":           525n        | (1n << 23n),
    "phi":             526n        | (1n << 23n),
    "gamma":           527n        | (1n << 23n),
}

type instruction = {
    "kind": "number" | "float" | "label" | "keyword" | "from",
    "value": any
};

export function draw(s: string, pix2: Piximal2) {
    let kwrds: {[key: string]: bigint} = {};
    Object.assign(kwrds, defaultKeywords);
    s = s.replace(ml_comment, " ");
    s = s.replace(sl_comment, "\n");
    s = s.replaceAll("\\\n", "");
    let toks = s.split(ws);
    let terms: instruction[] = [];
    toks.forEach((element) => {
        if (element == "") {
            // do nothing.
        } else if (numberRE.test(element)) {
            terms.push({"kind": "number", "value": BigInt(element.replaceAll("_",""))});
        } else if (floatRE.test(element)) {
            terms.push({"kind": "number", "value": pix2.numberToFloat24(Number.parseFloat(element))});
        } else if (element.endsWith(":")) {
            terms.push({"kind": "label", "value": element.slice(0, -1)});
        } else if (element.startsWith(":") && numberRE.test(element.slice(1))) {
            terms.push({"kind": "from", "value": BigInt(element.replaceAll("_","").slice(1))});
        } else {
            terms.push({"kind": "keyword", "value": element});
        }
    });

    let ind = 0;
    terms.forEach((element) => {
        if (element.kind == "label") {
            kwrds[element.value] = BigInt(ind);
        } else if (element.kind == "keyword") {
            if (Object.hasOwn(defaultKeywords, element.value)) {
                ind++;
            } else {
                ind += pix2.usingDoublePointers()? 2 : 1;
            }
        } else if (element.kind == "from") {
            ind = Number(element.value);
        } else {
            ind++;
        }
    });

    ind = 0;
    terms.forEach((element) => {
        if (element.kind == "number") {
            pix2.drawPixel(ind, pix2.intToColor(Number(element.value)));
            ind++;
        } else if (element.kind == "float") {
            pix2.drawPixel(ind, pix2.intToColor(element.value));
            ind++;
        } else if (element.kind == "keyword") {
            if (Object.hasOwn(defaultKeywords, element.value)) {
                pix2.drawPixel(ind, pix2.intToColor(Number(kwrds[element.value])));
                ind++;
            } else {
                pix2.writePointerToInd(ind, Number(kwrds[element.value]));
                ind += pix2.usingDoublePointers()? 2 : 1;
            }
        } else if (element.kind == "from") {
            ind = Number(element.value)
        }
    });
    pix2.commitPending();
}