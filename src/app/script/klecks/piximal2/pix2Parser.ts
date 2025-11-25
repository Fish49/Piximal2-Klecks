import { Piximal2 } from "./piximal2";

const sl_comment = /\/\/.*\n/g;
const ml_comment = /\/\*.*\*(\/)/gms;
const numberRE = /^((0x[0-9a-fA-F]+)|(0b[01]+$)|(0o[0-7]+)|([0-9]+))$/;
const ws = /\s+/g;

const defaultKeywords = {
    "p0": 0n                       | (1n << 23n),
    "p1": 1n                       | (1n << 23n),
    "pw": 2n                       | (1n << 23n),
    "os": 3n                       | (1n << 23n),
    "dref": 4n                     | (1n << 23n),
    "im": 5n                       | (1n << 23n),
    "wp": 6n                       | (1n << 23n),
    "hp": 7n                       | (1n << 23n),
    "npp": 8n                      | (1n << 23n),
    "origin": 9n                   | (1n << 23n),
    "dfc": 10n                     | (1n << 23n),
    "ntp": 11n                     | (1n << 23n),
    "thrp": 12n                    | (1n << 23n),
    "stp": 13n                     | (1n << 23n),
    "ins": 14n                     | (1n << 23n),
    "rstp": 15n                    | (1n << 23n),
    "arg": 16n                     | (1n << 23n),
    "loc": 17n                     | (1n << 23n),
    "thri": 18n                    | (1n << 23n),
    "coord": 19n                   | (1n << 23n),
    "funcorigin": 20n              | (1n << 23n),
    "funcos": 21n                  | (1n << 23n),
    "cmt": 22n                     | (1n << 23n),
    "stall":                         0n,
    "comment":                       1n,
    "copy":                          2n,
    "swap":                          3n,
    "call":                          4n,
    "return":                        5n,
    "jumpif":                        6n,
    "branch":                        7n,
    "jump":                          8n,
    "add":                           9n,
    "sub":                           10n,
    "mult":                          11n,
    "div":                           12n,
    "mod":                           13n,
    "neg":                           14n,
    "lshift":                        15n,
    "rshift":                        16n,
    "lshifto":                       17n,
    "rshifto":                       18n,
    "lrot":                          19n,
    "rrot":                          20n,
    "decompose":                     21n,
    "max":                           22n,
    "min":                           23n,
    "abs":                           24n,
    "not":                           25n,
    "or":                            26n,
    "and":                           27n,
    "xor":                           28n,
    "nor":                           29n,
    "nand":                          30n,
    "xnor":                          31n,
    "eq":                            32n,
    "ne":                            33n,
    "lt":                            34n,
    "gt":                            35n,
    "le":                            36n,
    "ge":                            37n,
    "tri":                           38n,
    "lnot":                          39n,
    "lor":                           40n,
    "land":                          41n,
    "lxor":                          42n,
    "lnor":                          43n,
    "lnand":                         44n,
    "lnxor":                         45n,
    "quant":                         46n,
    "resolve":                       47n,
    "consume":                       48n
};

type instruction = {
    "kind": "number" | "label" | "keyword" | "from",
    "value": any
}

export function draw(s: string, pix2: Piximal2) {
    let kwrds: {[key: string]: bigint} = {};
    Object.assign(kwrds, defaultKeywords);
    s = s.replace(ml_comment, " ");
    s = s.replace(sl_comment, " ");
    s = s.replace("\\\n", "");
    let toks = s.split(ws);
    // console.log(toks);
    let terms: instruction[] = [];
    toks.forEach((element) => {
        if (element == "") {
            // do nothing.
        } else if (numberRE.test(element)) {
            terms.push({"kind": "number", "value": BigInt(element)});
        } else if (element.endsWith(":")) {
            terms.push({"kind": "label", "value": element.slice(0, -1)});
        } else if (element.startsWith(":") && numberRE.test(element.slice(1))) {
            terms.push({"kind": "from", "value": BigInt(element.slice(1))});
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
        } else if (element.kind == "keyword") {
            if (Object.hasOwn(defaultKeywords, element.value)) {
                // console.log(element.value, kwrds[element.value].toString(2));
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
}