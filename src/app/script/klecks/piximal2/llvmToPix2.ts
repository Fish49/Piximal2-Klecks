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
    let m = s.matchAll(RegExp("(?<type>" + llvmType.source + ") (?<id>([%@]" + llvmId.source + ")|(" + llvmLiteral.source  + "))", "g"));
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

        m = RegExp("^(?<output>%" + llvmId.source + ") = (trunc|zext|sext|bitcast|ptrtoint|inttoptr) " + llvmType.source + " (?<input>([%@]" + llvmId.source +
            ")|(" + llvmLiteral.source + ")) to " + llvmType.source).exec(line);
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

function containsVariableDownstream(includingMe: boolean, variable: string, label: string, groups: {[id: string]: any[]}) {
    if (includingMe && groups[label][3].has(variable)) {
        return true;
    }
    for (let downstream of groups[variable][0]) {
        if (containsVariableDownstream(true, variable, downstream, groups)) {
            return true;
        }
    }
    return false;
}

function addPrefixedVariable(set: Set<string>, name: string, variable: string) {
    if (name.startsWith("%")) {
        set.add(name + variable);
    } else if (name.startsWith("@")) {
        set.add(variable);
    }
}

function getUsedVariables(name: string, instruction: any[]) {
    let ret = new Set<string>;
    if (instruction[0] == "branch") {
        addPrefixedVariable(ret, name, instruction[1]);
    } else if (instruction[0] == "binop") {
        addPrefixedVariable(ret, name, instruction[3]);
        addPrefixedVariable(ret, name, instruction[4]);
    } else if (instruction[0] == "load") {
        addPrefixedVariable(ret, name, instruction[3]);
    } else if (instruction[0] == "store") {
        addPrefixedVariable(ret, name, instruction[2]);
        addPrefixedVariable(ret, name, instruction[3]);
    } else if (instruction[0] == "getelementptr") {
        addPrefixedVariable(ret, name, instruction[3]);
        addPrefixedVariable(ret, name, instruction[4]);
    } else if (instruction[0] == "retval") {
        addPrefixedVariable(ret, name, instruction[2]);
    }
    return ret;
}

function getVariableString(variable: string, variables: {[id: string]: any[]}, stack: number[][]) {
    if (variable.startsWith("@")) {
        return variable;
    }
    if (variable.match("^" + llvmLiteral.source)) {
        return "im " + variable;
    }
    if (Object.hasOwn(variables, variable)) {
        return "sti im " + variables[variable];
    }
}

function parseFunction(name: string, args: (number | string)[], instructions: any[][]) {
    let blocks: {[id: string]: any[]} = {}; // i go to, i come from, instructions, variables
    let currentLabel = name + "%0";
    for (let instruction of instructions) {
        if (instruction[0] == "label") {
            currentLabel = name + "%" + instruction[1];
            if (!Object.hasOwn(blocks, currentLabel)) {
                blocks[currentLabel] = [[], [], [], new Set<string>];
            }
        } else {
            blocks[currentLabel][2].push(instruction);
        }

        if (instruction[0] == "jump") {
            blocks[currentLabel][0].push(instruction[1]);
            if (Object.hasOwn(blocks, instruction[1])) {
                blocks[instruction[1]][1].push(currentLabel);
            } else {
                blocks[instruction[1]] = [[], [currentLabel], [], new Set<string>];
            }
        } else if (instruction[0] == "branch") {
            blocks[currentLabel][0].push(instruction[2]);
            if (Object.hasOwn(blocks, instruction[2])) {
                blocks[instruction[2]][1].push(currentLabel);
            } else {
                blocks[instruction[2]] = [[], [currentLabel], [], new Set<string>];
            }
            blocks[currentLabel][0].push(instruction[3]);
            if (Object.hasOwn(blocks, instruction[3])) {
                blocks[instruction[3]][1].push(currentLabel);
            } else {
                blocks[instruction[3]] = [[], [currentLabel], [], new Set<string>];
            }
        }

        blocks[currentLabel][3] = blocks[currentLabel][3].union(getUsedVariables(name, instruction))
    }
    for (let block of Object.keys(blocks)) {
        let newInstructions = [];
        let ended = new Set<string>;
        for (let instructionInd = blocks[block][2].length - 1; instructionInd >= 0; instructionInd--) {
            newInstructions.push(blocks[block][2][instructionInd]);
            for (let variable of getUsedVariables(name, blocks[block][2][instructionInd])) {
                if (!ended.has(variable) && !containsVariableDownstream(false, variable, block, blocks)) {
                    ended.add(variable);
                    newInstructions.push(["free", variable]);
                }
            }
        }
        blocks[block][2] = newInstructions.toReversed();
    }

    let retLines = [name + ":"];
    let variables = {}; // name: value
    let stack = [];
    for (let block of Object.keys(blocks)) {
        if (block != name + "%0") {
            retLines.push(block + ":");
        }
        for (let instruction of blocks[block][2]) {
            if (instruction[0] == "binop") {

            }
        }
    }
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