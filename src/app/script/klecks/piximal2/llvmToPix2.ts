const sl_comment = /;.*$/gm;
const ml_comment = /\/\*.*\*(\/)/gs;
const llvmType = /([\[<]\d+ x )*(i\d+|float|double|ptr|label|void|half|bfloat|x86_fp80|fp128)[\]>]*/g
const llvmLiteral = /(-?\d+(\.\d+e[+-]\d+)?)|c".*"/g
const llvmId = /[-a-zA-Z$._0-9]*/g
const ignore1 = /, align \d+$/gm;
const ignore2 = /(^[ \t]+)|([ \t]+$)/gm;
const ignore4 = [
    'dso_local', 'dso_preemptable', 'internal', 'private', 'external',
    'noundef', 'zeroext', 'signext', 'nsw', 'nuw', 'exact',
    'inbounds', 'volatile', 'tail', 'musttail', 'notail',
    'noinline', 'nounwind', 'optnone', 'readonly', 'willreturn',
    'unnamed_addr', 'constant'
];

function sizeOfType(s: string) {
    let ret = 1;
    let m = s.matchAll(/^[\[<](?<amount>\d+) x /g);
    for (let match of m) {
        ret *= Number.parseInt(match.groups!["amount"]);
    }
    return ret;
}

function parseArgs(s: string) {
    let ret = [];
    let m = s.matchAll(RegExp("(?<type>" + llvmType.source + ") (?<id>[%@]" + llvmId.source + ")", "g"));
    for (let match of m) {
        ret.push([sizeOfType(match.groups!["type"]), match.groups!["id"]]);
    }
    return ret;
}

function parse(s: string) {
    s = s.replace(ml_comment, " ");
    s = s.replace(sl_comment, "\n");
    s = s.replace(ignore2, "");
    s = s.replace(ignore1, "");
    for (let ig of ignore4) {
        s = s.replaceAll(" " + ig + " ", " ");
    }

    let instructionArr: any[][] = [];
    for (let line of s.split("\n")) {
        let m: RegExpExecArray | null;
        if (line.startsWith("attributes") || line.startsWith("target") || line.startsWith("source_filename") || line.startsWith("!") || line.startsWith("declare") || line == "") {
            continue;
        }

        m = RegExp("^(?<id>@" + llvmId.source + ") = " + llvmType.source + " (?<value>" + llvmLiteral.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["global", m.groups!["id"], m.groups!["value"]]);
            // continue;
        }

        m = RegExp("^(?<id>@" + llvmId.source + ") = " + llvmType.source + " (?<value>\\[.*\\])").exec(line);
        if (m != null) {
            let value = m.groups!["value"].replace(RegExp(llvmType.source + " ", "g"), "");
            instructionArr.push(["globalArr", m.groups!["id"], value]);
            // continue;
        }

        m = RegExp("^define " + llvmType.source + " (?<id>@" + llvmId.source + ")\\((?<args>(" + llvmType.source + " %" + llvmId.source + ",?)*)\\) (#\\d+ )?{").exec(line);
        if (m != null) {
            instructionArr.push(["function", m.groups!["id"], parseArgs(m.groups!["args"])]);
        }

        m = RegExp("^(?<output>%" + llvmId.source + ") = (?<operation>add|sub|mul|sdiv|srem|udiv|urem|shl|lshr|ashr|and|" +
            "or|xor|icmp eq|icmp ne|icmp slt|icmp sle|icmp sgt|icmp sge|icmp ult|icmp ule|icmp ugt|icmp uge) " + llvmType.source +
            " (?<first>([@%]" + llvmId.source + ")|(" + llvmLiteral.source + ")), " +
            "(?<second>([@%]" + llvmId.source + ")|(" + llvmLiteral.source + "))"
        ).exec(line);
        if (m != null) {
            instructionArr.push(["binop", m.groups!["output"], m.groups!["operation"], m.groups!["first"], m.groups!["second"]]);
        }

        m = RegExp("^(?<output>%" + llvmId.source + ") = alloca (?<type>" + llvmType.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["alloca", m.groups!["output"], sizeOfType(m.groups!["type"])]);
        }

        m = RegExp("^(?<output>%" + llvmId.source + ") = load (?<type>" + llvmType.source + "), " + llvmType.source + " (?<input>[%@]" + llvmId.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["load", m.groups!["output"], sizeOfType(m.groups!["type"]), m.groups!["input"]]);
        }

        m = RegExp("^store (?<type>" + llvmType.source + ") (?<input>[%@]" + llvmId.source + "), " + llvmType.source + " (?<output>[%@]" + llvmId.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["store", sizeOfType(m.groups!["type"]), m.groups!["input"], m.groups!["output"]]);
        }

        m = RegExp("^(?<output>%" + llvmId.source + ") = getelementptr (?<type>" + llvmType.source + "), " + llvmType.source + " (?<base>[%@]" + llvmId.source +
            "), " + llvmType.source + " (?<index>[%@]" + llvmId.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["getelementptr", m.groups!["output"], sizeOfType(m.groups!["type"]), m.groups!["base"], m.groups!["index"]]);
        }

        m = RegExp("^br " + llvmType.source + " (?<location>[%@]" + llvmId.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["jump", m.groups!["location"]]);
        }

        m = RegExp("^br " + llvmType.source + " (?<cond>[%@]" + llvmId.source + "), " + llvmType.source + " (?<trueCase>[%@]" + llvmId.source +
            "), " + llvmType.source + " (?<falseCase>[%@]" + llvmId.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["branch", m.groups!["cond"], m.groups!["trueCase"], m.groups!["falseCase"]]);
        }

        m = RegExp("^ret (?<type>" + llvmType.source + ") (?<value>[%@]" + llvmId.source + ")").exec(line);
        if (m != null) {
            instructionArr.push(["retval", sizeOfType(m.groups!["type"]), m.groups!["value"]]);
        }

        m = /^ret void/.exec(line);
        if (m != null) {
            instructionArr.push(["ret"]);
        }

        m = RegExp("^(?<output>%" + llvmId.source + ") = call " + llvmType.source + " (?<function>@" + llvmId.source + ")\\((?<args>(" + llvmType.source +
            " [%@]" + llvmId.source + ",?)*)\\)").exec(line);
        if (m != null) {
            instructionArr.push(["call", m.groups!["output"], m.groups!["function"], parseArgs(m.groups!["args"])]);
            continue;
        }

        m = RegExp("^call void (?<function>@" + llvmId.source + ")\\((?<args>(" + llvmType.source + " [%@]" + llvmId.source + ",?)*)\\)").exec(line);
        if (m != null) {
            instructionArr.push(["voidcall", m.groups!["function"], parseArgs(m.groups!["args"])]);
            continue;
        }

        m = RegExp("^(?<output>%" + llvmId.source + ") = (trunc|zext|sext|bitcast|ptrtoint|inttoptr) " + llvmType.source + " (?<input>[%@]" + llvmId.source +
            ") to " + llvmType.source).exec(line);
        if (m != null) {
            instructionArr.push(["cast", m.groups!["output"], m.groups!["input"]]);
            continue;
        }

        m = /^(?<label>\d+):/.exec("line");
        if (m != null) {
            instructionArr.push(["label", m.groups!["label"]]);
            continue;
        }

        if (line == "}") {
            instructionArr.push(["functionend"]);
            continue;
        }

        instructionArr.push(["unresolved", line]);
    }

    console.log(JSON.stringify(instructionArr, null, 4));
    return instructionArr;
}

function parseFunction(name: string, args: (number | string)[], instructions: any[][]) {

}

export function transpile(s: string) {
    let usingMemCopy = false;
    let instructionArr = parse(s);
    let functions = [];
    let unFunctioned: any[][] = [];
    let currentFunction: null | [string, (number | string)[], any[][]] = null;
    for (let ins of instructionArr) {
        if (ins[0] == "function") {
            currentFunction = ["llvm" + ins[1], ins[2], []];
        } else if (ins[0] == "functionend") {
            functions.push(currentFunction);
            currentFunction = null;
        } else {
            if ((ins[0] == "call" && ins[2] == "@memcopy")) {
                usingMemCopy = true;
            }
            if (currentFunction != null) {
                currentFunction[2].push(ins);
            } else {
                unFunctioned.push(ins);
            }
        }
    }
}