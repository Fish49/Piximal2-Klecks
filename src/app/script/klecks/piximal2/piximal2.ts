import { BB } from '../../bb/bb';
import { draw } from "./pix2Parser";
import { Easel } from "../ui/easel/easel";
import { RGB } from "../../bb/color/color";
import { TIndexBounds } from '../../bb/bb-types';
import { TKlAppToolId } from "../../app/kl-app";
import { createArray } from '../../bb/base/base';
import { isLayerFill, TRgb, TRgba } from '../kl-types';
import { copyImageData } from '../utils/copy-image-data';
import { createImageDataTile } from '../history/image-data-tile';
import { KlHistory, HISTORY_TILE_SIZE } from "../history/kl-history";
import { getPushableLayerChange } from "../history/push-helpers/get-pushable-layer-change";
import { getChangedTiles, updateChangedTiles } from "../history/push-helpers/changed-tiles";
import { canvasAndChangedTilesToLayerTiles } from "../history/push-helpers/canvas-to-layer-tiles";
import { Eyedropper } from '../canvas/eyedropper';
import { Piximal2Ui } from '../ui/tool-tabs/piximal2-ui';

const mnemonics = [
    "stall",
    "comment",
    "copy",
    "swap",
    "call",
    "return",
    "jumpif",
    "branch",
    "jump",
    "add",
    "sub",
    "mult",
    "div",
    "mod",
    "neg",
    "lshift",
    "rshift",
    "lshifto",
    "rshifto",
    "lrot",
    "rrot",
    "decompose",
    "max",
    "min",
    "abs",
    "not",
    "or",
    "and",
    "xor",
    "nor",
    "nand",
    "xnor",
    "eq",
    "ne",
    "lt",
    "gt",
    "le",
    "ge",
    "tri",
    "lnot",
    "lor",
    "land",
    "lxor",
    "lnor",
    "lnand",
    "lxnor",
    "quant",
    "resolve",
    "consume"
]

const SMALLEST_NORMAL_32 = 2.22507385850720138309e-308;
const BIAS_24 = 0b0111111; // 63
const SMALLEST_NORMAL_24 = 2.16840434497100886801e-19;
const BIGGEST_24 = 18446603336221196288.0;
const INF_24_REPR = Number.parseInt("0 111_1111 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
const NEG_INF_24_REPR = Number.parseInt("1 111_1111 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
const NAN_24_REPR = Number.parseInt("0 111_1111 1000_0000 0000_0000".replace(/[_ ]*/g, ""),2);

export class Piximal2 {
    private context: CanvasRenderingContext2D = {} as CanvasRenderingContext2D;
    private eyedropper = new Eyedropper();
    private ui: Piximal2Ui | undefined;

    private klHistory: KlHistory = {} as KlHistory;
    private redrawBounds: TIndexBounds | undefined;
    private cells: (ImageData | undefined)[] = [];

    easel: Easel<TKlAppToolId>;

    private threadIndex = 0;

    constructor(easel: Easel<TKlAppToolId>) {
        this.easel = easel;
    }

    /**
     * draw cells onto context
     * @param cells
     */
    private drawCells(cells: (ImageData | undefined)[]): void {
        const cellsW = this.getCellsWidth();
        cells.forEach((imageData, index) => {
            if (!imageData) {
                return;
            }
            const cellOffsetX = (index % cellsW) * HISTORY_TILE_SIZE;
            const cellOffsetY = Math.floor(index / cellsW) * HISTORY_TILE_SIZE;
            this.context.putImageData(imageData, cellOffsetX, cellOffsetY);
        });
    }

    /**
     * draw changed cells (changed by brushstroke) onto context
     * @private
     */
    private drawChangedCells(): void {
        if (!this.redrawBounds) {
            return;
        }

        const cells: typeof this.cells = this.cells.map(() => undefined);
        const touchedCells = this.getTouchedCells(this.redrawBounds);
        touchedCells.forEach((isTouched, index) => {
            if (isTouched) {
                cells[index] = this.cells[index];
            }
        });
        this.drawCells(cells);
        this.redrawBounds = undefined;
    }

    /**
     * push changes to history
    */
    pushHistory() {
        this.drawChangedCells();
        if (this.cells.some((item) => item)) {
            this.klHistory.push(
                getPushableLayerChange(
                    this.klHistory.getComposed(),
                    this.cells.map((cell) => {
                        return cell ? createImageDataTile(cell) : undefined;
                    }),
                ),
                undefined,
                "piximal2"
            );
        }
        this.invalidateCache();
    }

    setHistory(klHistory: KlHistory): void {
        this.klHistory = klHistory;
        this.klHistory.addListener(() => {
                const top = this.klHistory.getEntries().at(-1);
                if (this.ui) {
                    this.ui.pointUpdateCallback();
                }
                if (!top) {
                    return;
                }
                if (top.description === "piximal2") {
                    return;
                }
                if (!top.data.layerMap) {
                    return;
                }
                const activeLayerId = klHistory.getComposed().activeLayerId;
                if (!top.data.layerMap[activeLayerId].tiles) {
                    return;
                }
                top.data.layerMap[activeLayerId].tiles.forEach((tile, index) => {
                    if (tile) {
                        this.cells[index] = undefined;
                    }
                });
                if (this.ui) {
                    this.ui.pointUpdateCallback();
                }
            }
        )
    }

    getWidth() {
        return this.context.canvas.width;
    }

    getHeight() {
        return this.context.canvas.height;
    }

    private getCellsWidth(): number {
        return Math.ceil(this.context.canvas.width / HISTORY_TILE_SIZE);
    }

    private getTouchedCells(bounds: TIndexBounds): boolean[] {
        const touchedCells = this.cells.map(() => false);
        const cellsW = this.getCellsWidth();
        bounds = {
            type: "index",
            x1: Math.floor(bounds.x1 / HISTORY_TILE_SIZE),
            y1: Math.floor(bounds.y1 / HISTORY_TILE_SIZE),
            x2: Math.floor(bounds.x2 / HISTORY_TILE_SIZE),
            y2: Math.floor(bounds.y2 / HISTORY_TILE_SIZE),
        };
        for (let i = bounds.x1; i <= bounds.x2; i++) {
            for (let e = bounds.y1; e <= bounds.y2; e++) {
                touchedCells[e * cellsW + i] = true;
            }
        }
        return touchedCells;
    }

    /**
     * update copyImageData. copy over new regions if needed
     */
    private copyFromCanvas(bounds: TIndexBounds | undefined): void {
        if (!bounds) {
            return;
        }

        const touchedCells = this.getTouchedCells(bounds);
        const composed = this.klHistory.getComposed()
        const composedLayer = composed.layerMap[composed.activeLayerId];

        touchedCells.forEach((item, i) => {
            if (!item || this.cells[i]) {
                // not touched, or already copied
                return;
            }
            const composedTile = composedLayer.tiles[i];
            if (isLayerFill(composedTile)) {
                const canvas = BB.canvas(HISTORY_TILE_SIZE, HISTORY_TILE_SIZE);
                const ctx = BB.ctx(canvas);
                ctx.fillStyle = composedTile.fill;
                ctx.fillRect(0, 0, HISTORY_TILE_SIZE, HISTORY_TILE_SIZE);
                this.cells[i] = ctx.getImageData(0, 0, HISTORY_TILE_SIZE, HISTORY_TILE_SIZE);
            } else {
                this.cells[i] = copyImageData(composedTile.data);
            }
        });
    }

    /**
     * Slice up bounds according to cells
     * @param bounds
     * @private
     */
    private sliceBounds(bounds: TIndexBounds): { index: number; bounds: TIndexBounds }[] {
        const cellsW = this.getCellsWidth();
        const result: { index: number; bounds: TIndexBounds }[] = [];
        const touchedCells = this.getTouchedCells(bounds);

        touchedCells.forEach((cell, i) => {
            if (!cell) {
                return;
            }

            const cellOffsetX = (i % cellsW) * HISTORY_TILE_SIZE;
            const cellOffsetY = Math.floor(i / cellsW) * HISTORY_TILE_SIZE;
            const cellWidth = this.cells[i]!.width;
            const cellHeight = this.cells[i]!.height;

            const inCellBounds: TIndexBounds = {
                type: "index",
                x1: Math.max(0, bounds.x1 - cellOffsetX),
                y1: Math.max(0, bounds.y1 - cellOffsetY),
                x2: Math.min(cellWidth - 1, bounds.x2 - cellOffsetX),
                y2: Math.min(cellHeight - 1, bounds.y2 - cellOffsetY),
            };
            if (inCellBounds.x1 > inCellBounds.x2 || inCellBounds.y1 > inCellBounds.y2) {
                return;
            }
            result.push({
                index: i,
                bounds: inCellBounds,
            });
        });

        return result;
    }

    drawPixelAtCoords(x: number, y: number, color: RGB) {
        const bounds: TIndexBounds = {type: "index", x1: x, y1: y, x2: x + 1, y2: y + 1};
        this.copyFromCanvas(bounds);
        const slice = this.sliceBounds(bounds)[0];
        const cell = this.cells[slice.index];
        const data = cell!.data;
        const pixelIndex = slice.bounds.y1 * cell!.width + slice.bounds.x1;
        this.redrawBounds = BB.updateBounds(this.redrawBounds, bounds);

        data[4*pixelIndex] = color.r;
        data[4*pixelIndex+1] = color.g;
        data[4*pixelIndex+2] = color.b;
    }

    getPixelAtCoords(x: number, y: number) {
        const bounds: TIndexBounds = {type: "index", x1: x, y1: y, x2: x + 1, y2: y + 1};
        const cellsW = this.getCellsWidth();
        const cellIndex = Math.floor(y / HISTORY_TILE_SIZE) * cellsW + Math.floor(x / HISTORY_TILE_SIZE);
        if (!this.cells[cellIndex]) {
            return this.eyedropper.getColorAt(x, y, this.klHistory.getComposed());
        }
        this.copyFromCanvas(bounds);
        const slice = this.sliceBounds(bounds)[0];
        const cell = this.cells[slice.index];
        const data = cell!.data;
        const pixelIndex = slice.bounds.y1 * cell!.width + slice.bounds.x1;

        return new RGB(data[pixelIndex*4], data[pixelIndex*4+1], data[pixelIndex*4+2])
    }

    coordsToInd(x: number, y: number) {
        return (y * this.getWidth()) + x;
    }

    row(ind: number) {
        let trueInd = ind % (this.getWidth() * this.getHeight());
        return Math.floor(trueInd / this.getWidth());
    }

    column(ind: number) {
        let trueInd = ind % (this.getWidth() * this.getHeight());
        return trueInd % this.getWidth();
    }

    drawPixel(ind: number, color: RGB) {
        this.drawPixelAtCoords(this.column(ind), this.row(ind), color);
    }

    getPixel(ind: number) {
        return this.getPixelAtCoords(this.column(ind), this.row(ind));
    }

    copyPixelString(indFrom: number, width: number, indTo: number) {
        for (let i = 0; i < width; i++) {
            this.drawPixel(indTo + i, this.getPixel(indFrom + i));
        }
    }

    readPixelString(ind: number, width: number): RGB[] {
        let ret = [];
        for (let i = 0; i < width; i++) {
            ret.push(this.getPixel(ind + i));
        }
        return ret;
    }

    writePixelString(ind: number, data: RGB[]) {
        for (let i = 0; i < data.length; i++) {
            this.drawPixel(ind + i, data[i]);
        }
    }

    numToBinary(x: number) {
        let ret = [];
        while (x != 0) {
            ret.push((x & 1) == 1);
            x >>= 1;
        }
        ret.reverse()
        return ret;
    }

    channelToBinary(x: number) {
        let ret = this.numToBinary(x);
        if (ret.length == 8) {
            return ret;
        }
        if (ret.length < 8) {
            ret = [false, false, false, false, false, false, false, false].concat(ret);
        }
        return ret.slice(-8);
    }

    colorToBinary(color: RGB) {
        let ret = this.channelToBinary(color.r);
        ret.push(...this.channelToBinary(color.g));
        ret.push(...this.channelToBinary(color.b));
        return ret;
    }

    invalidateCache() {
        const totalCells = Math.ceil(this.context.canvas.width / HISTORY_TILE_SIZE) *
        Math.ceil(this.context.canvas.height / HISTORY_TILE_SIZE);
        this.cells = createArray(totalCells, undefined);
    }
    
    setContext(c: CanvasRenderingContext2D): void {
        this.context = c;
        this.invalidateCache();
    }

    setUi(ui: Piximal2Ui) {
        this.ui = ui;
    }

    requestRender() {
        this.drawChangedCells();
        this.easel.requestRender();
        this.ui?.pointUpdateCallback();
    }

    usingDoublePointers() {
        return (this.getWidth()*this.getHeight()) > (2**23);
    }

    binaryToInt(x: boolean[]) {
        let r = 0;
        x.forEach((element) => {
            r <<= 1;
            r |= element? 1:0;
        });
        return r;
    }

    colorToInt(x: RGB) {
        return (x.r << 16) | (x.g << 8) | x.b
    }

    intToColor(x: number) {
        return new RGB((x >> 16) & 0xff, (x >> 8) & 0xff, x & 0xff);
    }

    readPixelPointerRaw(ind: number) {
        let first = this.colorToInt(this.getPixel(ind));
        if (this.usingDoublePointers()) {
            let second = this.colorToInt(this.getPixel(ind+1));
            return (first << 24) + second;
        }
        return first;
    }

    getNextIndAfterPointer(ind: number): number {
        let color = this.getPixel(ind);
        let int = this.colorToInt(color);
        if ((int & 0x800000) == 0) { // if its not a special pointer
            return ind + (this.usingDoublePointers()? 2:1);
        }
        let specialPointerType = int & 0x7fffff;
        switch (specialPointerType) {
            case 0:
            case 1:
            case 2:
            case 6:
            case 7:
            case 8:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 18:
            case 20:
            default:
                return ind + 1;
            case 5:
            case 16:
            case 17:
                return ind + 2;
            case 19:
            case 3:
                return this.getNextIndAfterPointer(this.getNextIndAfterPointer(ind + 1));
            case 4:
            case 21:
                return this.getNextIndAfterPointer(ind + 1);
            case 22:
                for (let i = ind; true; i++) {
                    if (this.colorToInt(this.getPixel(i)) == 0){
                        return i + 1;
                    }
                }
        }
    }

    getLiteralPointer(ind: number): number {
        let color = this.getPixel(ind);
        let int = this.colorToInt(color);
        if ((int & 0x800000) == 0) { // if its not a special pointer
            return this.readPixelPointerRaw(ind);
        }
        let specialPointerType = int & 0x7fffff;
        switch (specialPointerType) {
            case 0:
            case 1:
            case 2:
            case 9:
            case 18:
            case 22:
            default:
                return 0;
            case 3:
                return this.getLiteralPointer(ind + 1) + this.colorToInt(this.readPointer(this.getNextIndAfterPointer(ind + 1)));
            case 4:
                return this.getLiteralPointer(this.getLiteralPointer(ind + 1));
            case 5:
                return ind + 1;
            case 6:
                return this.getWidth() - 1;
            case 7:
                return this.getWidth() * (this.getHeight() - 1);
            case 8:
                return (this.getWidth() * this.getHeight()) - 1;
            case 10:
                return 1;
            case 11:
                return 2;
            case 12: // TODO: what the heck is this code
                let possibleHeadache = this.getThreadPointerInd();
                if (this.colorToInt(this.getPixel(possibleHeadache)) == 0b1000_1011) {
                    return this.readPixelPointerRaw(possibleHeadache);
                }
                return this.getLiteralPointer(possibleHeadache);
            case 13:
                return this.getLiteralPointer(this.getThreadPointerInd());
            case 14:
                return this.getLiteralPointer(this.getNextIndAfterPointer(this.getLiteralPointer(this.getThreadPointerInd())));
            case 15: {
                let stackTop = this.getLiteralPointer(this.getLiteralPointer(this.getThreadPointerInd()));
                return this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(stackTop))) +
                this.colorToInt(this.readPointer(stackTop)) +
                this.colorToInt(this.getPixel(this.getLiteralPointer(stackTop) + 1));
            }
            case 16: {
                let stackTop = this.getLiteralPointer(this.getLiteralPointer(this.getThreadPointerInd()));
                return this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(stackTop))) +
                this.colorToInt(this.getPixel(ind + 1));
            }
            case 17: {
                let stackTop = this.getLiteralPointer(this.getLiteralPointer(this.getThreadPointerInd()));
                return this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(stackTop))) +
                this.colorToInt(this.readPointer(stackTop)) +
                this.colorToInt(this.getPixel(ind + 1));
            }
            case 19: {
                return this.coordsToInd(this.colorToInt(this.readPointer(ind + 1)), this.colorToInt(this.readPointer(this.getNextIndAfterPointer(ind + 1))));
            }
            case 20: {
                return this.getLiteralPointer(this.getLiteralPointer(this.getThreadPointerInd()));
            }
            case 21: {
                return this.getLiteralPointer(this.getLiteralPointer(this.getLiteralPointer(this.getThreadPointerInd()))) + this.getLiteralPointer(ind + 1);
            }

        }
    }

    readPointer(ind: number): RGB {
        let color = this.getPixel(ind);
        let int = this.colorToInt(color);
        if ((int & 0x800000) == 0) { // if its not a special pointer
            return this.getPixel(this.readPixelPointerRaw(ind));
        }
        let specialPointerType = int & 0x7fffff;
        switch (specialPointerType) {
            case 0:
            case 22:
            default:
                return new RGB(0,0,0);
            case 1:
                return new RGB(0,0,1);
            case 2:
                return new RGB(255, 255, 255);
            case 4:
                return this.readPointer(this.getLiteralPointer(ind + 1))
            case 6:
                return this.intToColor(this.getWidth());
            case 7:
                return this.intToColor(this.getHeight());
            case 8:
                return this.intToColor(this.getWidth() * this.getHeight());
            case 3:
            case 5:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 19:
            case 20:
            case 21:
                return this.getPixel(this.getLiteralPointer(ind));
            case 18:
                return this.intToColor(this.threadIndex);
        }
    }

    writePointer(ind: number, value: RGB) {
        let color = this.getPixel(ind);
        let int = this.colorToInt(color);
        if ((int & 0x800000) == 0) { // if its not a special pointer
            this.drawPixel(this.readPixelPointerRaw(ind), value);
            return;
        }
        let specialPointerType = int & 0x7fffff;
        switch (specialPointerType) {
            case 4:
                this.writePointer(this.getLiteralPointer(ind + 1), value);
                return;
            case 0:
            case 1:
            case 2:
            case 6:
            case 7:
            case 8:
            case 18:
            case 22:
            default:
                return;
            case 3:
            case 5:
            case 9:
            case 10:
            case 11:
            case 12:
            case 13:
            case 14:
            case 15:
            case 16:
            case 17:
            case 19:
            case 20:
            case 21:
                this.drawPixel(this.getLiteralPointer(ind), value);
                return;
        }
    }

    getThreadPointerInd() {
        let threadPointerInd = 3
        for (let i = 0; i < this.threadIndex; i++) {
            threadPointerInd = this.getNextIndAfterPointer(threadPointerInd);
        }
        return threadPointerInd;
    }

    writePointerToInd(ind: number, pointerInd: number) {
        if (this.usingDoublePointers()) {
            let first = this.intToColor((pointerInd >> 24) & 0xffffff);
            let second = this.intToColor(pointerInd & 0xffffff);
            this.drawPixel(ind, first);
            this.drawPixel(ind + 1, second);
        } else {
            let value = this.intToColor(pointerInd & 0xffffff);
            this.drawPixel(ind, value);
        }
    }

    moveExecutionPointer(threadPointerInd: number, newInd: number) {
        this.writePointerToInd(this.getNextIndAfterPointer(this.getLiteralPointer(threadPointerInd)), newInd);
    }

    numberToFloat24(x: number) {
        let output = 0;
        if (Number.isNaN(x)) {
            return NAN_24_REPR;
        }
        if (x > BIGGEST_24) {
            return INF_24_REPR;
        }
        if (x < -BIGGEST_24) {
            return NEG_INF_24_REPR;
        }
        if (x < 0 || Object.is(x, -0.0)) {
            output |= 1 << 23;
        }
        x = Math.abs(x);

        let exponent = 0; //52
        while ((x >= 2 || x < 1) && exponent > -62) {
            if (x >= 2) {
                exponent += 1;
                x /= 2;
            } else if (x < 1) {
                exponent -= 1;
                x *= 2;
            }
        }
        if (x < 1) {
            exponent -= 1;
        } else {
            x -= 1;
        }
        // console.log(exponent);
        x *= 2**16;
        x = Math.round(x);
        while (x >> 16 >= 1) {
            if (exponent >= 63) {
                return INF_24_REPR | output;
            }
            x >>= 1
            exponent += 1
        }
        return output | ((exponent + BIAS_24) << 16) | (x & 0xFFFF);
    }

    float24ToNumber(x: number) {
        let exponent = (x >> 16) & 0b111_1111;
        let fraction = x & 0xFFFF;
        let sign = -2*((x >> 23) & 1) + 1;
        if (exponent === 0b111_1111) {
            if (fraction != 0) {
                return NaN;
            }
            if (sign === -1) {
                return Number.NEGATIVE_INFINITY;
            }
            return Number.POSITIVE_INFINITY;
        }
        fraction /= 2**16
        if (exponent === 0) {
            return fraction;
        }
        exponent -= BIAS_24;
        fraction += 1;
        return sign * fraction * (2**exponent);
    }

    step(verbose: boolean) {
        let versionPixel = this.getPixel(0);
        if (versionPixel.r != 0 || versionPixel.g != 0 || versionPixel.b != 2) {return;} // return if not version 2
        for (this.threadIndex = 0; this.threadIndex < this.colorToInt(this.getPixel(2)); this.threadIndex++) {
            let threadPointerInd = this.getThreadPointerInd();
            let executionPointer = this.getLiteralPointer(this.getNextIndAfterPointer(this.getLiteralPointer(threadPointerInd)));
            let instruction = this.colorToInt(this.getPixel(executionPointer));
            let argumentPointer = executionPointer + 1;
            if (verbose) {
                console.log(instruction, mnemonics[instruction]);
            }
            switch (instruction) {
                case 0:
                default: {
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    break;
                }
                case 1: {
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    break;
                }
                case 2: {
                    let value = this.readPointer(argumentPointer);
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let outPointer = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(outPointer, value);
                    break;
                }
                case 3: {
                    let valueA = this.readPointer(argumentPointer);
                    let pointerA = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let valueB = this.readPointer(argumentPointer);
                    let pointerB = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(pointerA, valueB);
                    this.writePointer(pointerB, valueA);
                    break;
                }
                case 4: {
                    let stackTop = this.getLiteralPointer(this.getLiteralPointer(threadPointerInd));
                    let currentFuncNumOfArguments = this.colorToInt(this.getPixel(this.getLiteralPointer(stackTop)));
                    let currentFuncLocalBufferSize = this.colorToInt(this.getPixel(this.getLiteralPointer(stackTop) + 1));
                    let newStackTop = this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(stackTop))) +
                        currentFuncNumOfArguments +
                        currentFuncLocalBufferSize;
                    let func = this.getLiteralPointer(argumentPointer);
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let newFuncNumOfArguments = this.colorToInt(this.getPixel(func));
                    let argumentPixels = this.readPixelString(argumentPointer, newFuncNumOfArguments);
                    argumentPointer += newFuncNumOfArguments;
                    let stackFrameBuilder = newStackTop;
                    this.writePointerToInd(this.getLiteralPointer(threadPointerInd), newStackTop);
                    this.moveExecutionPointer(threadPointerInd, func + 2);
                    this.writePointerToInd(stackFrameBuilder, func);
                    stackFrameBuilder = this.getNextIndAfterPointer(stackFrameBuilder);
                    this.writePointerToInd(stackFrameBuilder, stackTop);
                    stackFrameBuilder = this.getNextIndAfterPointer(stackFrameBuilder);
                    this.writePointerToInd(stackFrameBuilder, argumentPointer);
                    stackFrameBuilder = this.getNextIndAfterPointer(stackFrameBuilder);
                    this.writePixelString(stackFrameBuilder, argumentPixels);
                    break;
                }
                case 5: {
                    let stackTop = this.getLiteralPointer(this.getLiteralPointer(threadPointerInd));
                    let newStackTop = this.getLiteralPointer(this.getNextIndAfterPointer(stackTop));
                    let newExecutionPointer = this.getLiteralPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(stackTop)));
                    this.moveExecutionPointer(threadPointerInd, newExecutionPointer);
                    this.writePointerToInd(this.getLiteralPointer(threadPointerInd), newStackTop);
                    break;
                }
                case 6: {
                    let condition = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let trueCase = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    if (condition != 0) {
                        this.moveExecutionPointer(threadPointerInd, this.getLiteralPointer(trueCase));
                    } else {
                        this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    }
                    break;
                }
                case 7: {
                    let condition = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let trueCase = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let falseCase = argumentPointer;
                    if (condition != 0) {
                        this.moveExecutionPointer(threadPointerInd, this.getLiteralPointer(trueCase));
                    } else {
                        this.moveExecutionPointer(threadPointerInd, this.getLiteralPointer(falseCase));
                    }
                    break;
                }
                case 8: {
                    this.moveExecutionPointer(threadPointerInd, this.getLiteralPointer(argumentPointer));
                    break;
                }
                case 9: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) + this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 10: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) - this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 11: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) * this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 12: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    if (this.colorToInt(this.readPointer(b)) == 0) {
                        break;
                    }
                    this.writePointer(out, this.intToColor(Math.trunc(this.colorToInt(this.readPointer(a)) / this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 13: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) % this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 14: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(-this.colorToInt(this.readPointer(a))));
                    break;
                }
                case 15: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) << this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 16: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) >> this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 17: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let outA = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let outB = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(outA, this.intToColor(this.colorToInt(this.readPointer(a)) << this.colorToInt(this.readPointer(b))));
                    this.writePointer(outB, this.intToColor(this.colorToInt(this.readPointer(a)) >> (24 - this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 18: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let outA = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let outB = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(outA, this.intToColor(this.colorToInt(this.readPointer(a)) >> this.colorToInt(this.readPointer(b))));
                    this.writePointer(outB, this.intToColor(this.colorToInt(this.readPointer(a)) << (24 - this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 19: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = (this.colorToInt(this.readPointer(a)) << this.colorToInt(this.readPointer(b))) |
                        (this.colorToInt(this.readPointer(a)) >> (24 - this.colorToInt(this.readPointer(b))));
                    this.writePointer(out, this.intToColor(result));
                    break;
                }
                case 20: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = (this.colorToInt(this.readPointer(a)) >> this.colorToInt(this.readPointer(b))) |
                        (this.colorToInt(this.readPointer(a)) << (24 - this.colorToInt(this.readPointer(b))));
                    this.writePointer(out, this.intToColor(result));
                    break;
                }
                case 21: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let r = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let g = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let color = this.readPointer(a)
                    this.writePointer(r, this.intToColor(color.r));
                    this.writePointer(g, this.intToColor(color.g));
                    this.writePointer(b, this.intToColor(color.b));
                    break;
                }
                case 22: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(Math.max(this.colorToInt(this.readPointer(a)), this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 23: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(Math.min(this.colorToInt(this.readPointer(a)), this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 24: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(Math.abs(this.colorToInt(this.readPointer(a)))));
                    break;
                }
                case 25: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(~this.colorToInt(this.readPointer(a))));
                    break;
                }
                case 26: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) | this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 27: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) & this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 28: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(this.colorToInt(this.readPointer(a)) ^ this.colorToInt(this.readPointer(b))));
                    break;
                }
                case 29: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(~(this.colorToInt(this.readPointer(a)) | this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 30: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(~(this.colorToInt(this.readPointer(a)) & this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 31: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, this.intToColor(~(this.colorToInt(this.readPointer(a)) ^ this.colorToInt(this.readPointer(b)))));
                    break;
                }
                case 32: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = this.colorToInt(this.readPointer(a)) == this.colorToInt(this.readPointer(b));
                    this.writePointer(out, result? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 33: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = this.colorToInt(this.readPointer(a)) == this.colorToInt(this.readPointer(b));
                    this.writePointer(out, result? new RGB(0,0,0) : new RGB(255,255,255));
                    break;
                }
                case 34: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = this.colorToInt(this.readPointer(a)) < this.colorToInt(this.readPointer(b));
                    this.writePointer(out, result? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 35: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = this.colorToInt(this.readPointer(a)) > this.colorToInt(this.readPointer(b))
                    this.writePointer(out, result? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 36: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = this.colorToInt(this.readPointer(a)) <= this.colorToInt(this.readPointer(b))
                    this.writePointer(out, result? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 37: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let result = this.colorToInt(this.readPointer(a)) >= this.colorToInt(this.readPointer(b))
                    this.writePointer(out, result? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 38: {
                    let condition = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let trueCase = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let falseCase = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, condition == 0? this.readPointer(falseCase) : this.readPointer(trueCase));
                    break;
                }
                case 39: {
                    let condition = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, condition == 0? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 40: {
                    let a = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let condition = (a != 0) || (b != 0);
                    this.writePointer(out, condition? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 41: {
                    let a = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let condition = (a != 0) && (b != 0);
                    this.writePointer(out, condition? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 42: {
                    let a = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let condition = (a != 0)? (b == 0) : (b != 0);
                    this.writePointer(out, condition? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 43: {
                    let a = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let condition = !((a != 0) || (b != 0));
                    this.writePointer(out, condition? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 44: {
                    let a = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let condition = !((a != 0) && (b != 0));
                    this.writePointer(out, condition? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 45: {
                    let a = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let b = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    let condition = (a != 0)? (b != 0) : (b == 0);
                    this.writePointer(out, condition? new RGB(255,255,255) : new RGB(0,0,0));
                    break;
                }
                case 46: {
                    let condition = this.colorToInt(this.readPointer(argumentPointer));
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointer(out, condition == 0? new RGB(0,0,0) : new RGB(255,255,255));
                    break;
                }
                case 47: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointerToInd(this.getLiteralPointer(out), this.getLiteralPointer(a));
                    break;
                }
                case 48: {
                    let a = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    let out = argumentPointer;
                    argumentPointer = this.getNextIndAfterPointer(argumentPointer);
                    this.moveExecutionPointer(threadPointerInd, argumentPointer);
                    this.writePointerToInd(this.getLiteralPointer(out), this.getNextIndAfterPointer(this.getLiteralPointer(a)));
                    break;
                }
            }
        }
    }

    compile(s: string) {
        draw(s, this);
    }
}