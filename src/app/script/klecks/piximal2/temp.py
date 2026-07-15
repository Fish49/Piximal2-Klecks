import json
import re
fp = "src/app/script/klecks/piximal2/instructions.json"
a = []
with open(fp, "r") as file:
    a = json.load(file)

for i in range(len(a)):
    a[i]["next"] = "default"
    if (a[i]["opcode"] >= 512):
        a[i]["rules"] = [{"rule":"NaNifNaN", "arguments": max(len(a[i]["arguments"])-1,0)}]
    else:
        a[i]["rules"] = []

def callback(ma: re.Match):
    gd = ma.groupdict()
    if gd["c"] == ",":
        return gd["type"] + " "
    return gd["type"]

def callback2(ma: re.Match):
    return f"\"arguments\": {list(range(int(ma.groupdict()["howmany"])))}"

st = json.dumps(a, indent=4)
st = re.sub(r"\s*(?P<type>\"(color|outputColor|bool|outputBool|int|outputInt|float24|outputFloat24|pointer|outputPointer)\"(?P<c>,?))\s*", callback, st, flags=re.MULTILINE)
st = re.sub(r"\"arguments\": (?P<howmany>[0-9]+)", callback2, st, flags=re.MULTILINE)
print(st[:1000])
with open(fp, "w") as file:
    file.write(st)
