import { BB } from '../../bb/bb';
import { defaultKeywords, draw } from "./pix2Parser";
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
// import INSTRUCTIONS_JSON from "./instructions.json";
const INSTRUCTIONS_JSON: any = import("./instructions.json", {assert: {type: "json"}});
(INSTRUCTIONS_JSON as Promise<Array<InstructionType>>).then((value) => {
    INSTRUCTIONS = instructionsFromJson(value);
});

const SMALLEST_NORMAL_32 = 2.22507385850720138309e-308;
// 24 bit float - sign(1), exponent(6), mantissa(17)
const BIAS_24 = 0b01_1111; // 31
const SMALLEST_NORMAL_24 = 9.31322574615478515625e-10; // 00_0001 0 0000_0000 0000_0000
const BIGGEST_24 = 4294950912.0; // 0 11_1110 1 1111_1111 1111_1111
const BIGGEST_SAFE_INT_24 = 262144.0 // 0 11_0001 0 0000_0000 0000_0000
const INF_24_REPR = Number.parseInt("0 11_1111 0 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
const NEG_INF_24_REPR = Number.parseInt("1 11_1111 0 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
const NAN_24_REPR = Number.parseInt("0 11_1111 1 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
//48 bit float - sign(1), exponent(10), mantissa(37)
const BIAS_48 = 0b01_1111_1111; // 511
const SMALLEST_NORMAL_48 = 2.98333629248008269732e-154; // 0 00_0000_0001 0_0000 0000_0000 0000_0000 0000_0000 0000_0000
const BIGGEST_48 = 1.34078079298938197785e+154 // 0 11_1111_1110 1_1111 1111_1111 1111_1111 1111_1111 1111_1111
const BIGGEST_SAFE_INT_48 = 274877906944.0; // 0 10_0010_0101 0_0000 0000_0000 0000_0000 0000_0000 0000_0000
const INF_48_REPR = Number.parseInt("0 11_1111_1111 0_0000 0000_0000 0000_0000 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
const NEG_INF_48_REPR = Number.parseInt("1 11_1111_1111 0_0000 0000_0000 0000_0000 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);
const NAN_48_REPR = Number.parseInt("0 11_1111_1111 1_0000 0000_0000 0000_0000 0000_0000 0000_0000".replace(/[_ ]*/g, ""),2);

const COLOR_ZERO = new RGB(0,0,0);
const COLOR_ONE = new RGB(0,0,1);
const COLOR_WHITE = new RGB(255,255,255);

let INSTRUCTIONS: {[id: number]: InstructionType};
type InstructionType = {
    opcode: number,
    arguments: Array<Array<string>>,
    mnemonic: string,
    next: string,
    rules: Array<{"rule": string, "arguments": Array<number>}>
};

function instructionsFromJson(json: Array<InstructionType>) {
    let ret: {[id: number]: InstructionType} = {};
    json.forEach((element) => {
        ret[element.opcode] = element;
        defaultKeywords[element.mnemonic] = BigInt(element.opcode);
    });
    return ret;
}

function truemod(x: number, y: number) {
    // console.log(x, y, (x % y)+y);
    return ((x % y) + y) % y;
}

export class Piximal2 {
    private context: CanvasRenderingContext2D = {} as CanvasRenderingContext2D;
    width = 0;
    height = 0;
    private eyedropper = new Eyedropper();
    private ui: Piximal2Ui | undefined;

    private klHistory: KlHistory = {} as KlHistory;
    private redrawBounds: TIndexBounds | undefined;
    private cells: (ImageData | undefined)[] = [];
    private pendingChanges: {x: number, y: number, color: RGB}[] = [];

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
                if (this.context.canvas.width != this.width || this.context.canvas.height != this.height) {
                    this.invalidateCache();
                }
                if (this.ui) {
                    this.ui.pointUpdateCallback();
                }
            }
        )
    }

    private getCellsWidth(): number {
        return Math.ceil(this.width / HISTORY_TILE_SIZE);
    }

    private getTouchedCells(bounds: TIndexBounds): boolean[] {
        const touchedCells = this.cells.map(() => false);
        const cellsW = this.getCellsWidth();
        bounds = {
            type: "index",
            x1: Math.floor(bounds.x1 / HISTORY_TILE_SIZE),
            y1: Math.floor(bounds.y1 / HISTORY_TILE_SIZE),
            x2: Math.ceil(bounds.x2 / HISTORY_TILE_SIZE),
            y2: Math.ceil(bounds.y2 / HISTORY_TILE_SIZE),
        };
        for (let i = bounds.x1; i < bounds.x2; i++) {
            for (let e = bounds.y1; e < bounds.y2; e++) {
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
        this.pendingChanges.push({x: x, y: y, color: color});
    }

    commitPending() {
        this.pendingChanges.forEach((change) => {
            this.drawPixelAtCoordsFinal(change.x, change.y, change.color);
        });
        this.pendingChanges = [];
    }

    drawPixelAtCoordsFinal(x: number, y: number, color: RGB) {
        const bounds: TIndexBounds = {type: "index", x1: x, y1: y, x2: x+1, y2: y+1};
        this.copyFromCanvas(bounds);
        const slice = this.sliceBounds(bounds)[0];
        if (slice == undefined) {
            console.log(this.sliceBounds(bounds), x, y);
        }
        const cell = this.cells[slice.index];
        const data = cell!.data;
        const pixelIndex = slice.bounds.y1 * cell!.width + slice.bounds.x1;
        this.redrawBounds = BB.updateBounds(this.redrawBounds, bounds);

        data[4*pixelIndex] = color.r;
        data[4*pixelIndex+1] = color.g;
        data[4*pixelIndex+2] = color.b;
    }

    getPixelAtCoords(x: number, y: number) {
        const bounds: TIndexBounds = {type: "index", x1: x, y1: y, x2: x+1, y2: y+1};
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
        return (truemod(y, this.height) * this.width) + truemod(x, this.width);
    }

    row(ind: number) {
        let trueInd = truemod(ind, (this.width * this.height));
        return Math.floor(trueInd / this.width);
    }

    column(ind: number) {
        let trueInd = truemod(ind, (this.width * this.height));
        return trueInd % this.width;
    }

    drawPixel(ind: number, color: RGB) {
        ind = ind;
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
        this.width = this.context.canvas.width;
        this.height = this.context.canvas.height;
        const totalCells = Math.ceil(this.width / HISTORY_TILE_SIZE) *
        Math.ceil(this.height / HISTORY_TILE_SIZE);
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
        return (this.width*this.height) > (2**23);
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
        return -(1 << 23)*((x.r >> 7) & 1)+(((x.r & 0x7f) << 16) | (x.g << 8) | x.b);
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
            // case 13:
            case 14:
            // case 15:
            case 18:
            // case 20:
            case 23:
            case 24:
            case 512:
            case 513:
            case 514:
            case 515:
            case 516:
            case 517:
            case 518:
            case 519:
            case 520:
            case 521:
            case 522:
            case 523:
            case 524:
            case 525:
            case 526:
            case 527:
            default:
                return ind + 1;
            case 5:
            // case 16:
            // case 17:
                return ind + 2;
            case 19:
            case 3:
                return this.getNextIndAfterPointer(this.getNextIndAfterPointer(ind + 1));
            case 4:
            // case 21:
            case 25:
            case 26:
            case 27:
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
            case 512:
            case 513:
            case 514:
            case 515:
            case 516:
            case 517:
            case 518:
            case 519:
            case 520:
            case 521:
            case 522:
            case 523:
            case 524:
            case 525:
            case 526:
            case 527:
            default:
                return 0;
            case 3:
                return this.getLiteralPointer(ind + 1) + this.colorToInt(this.readPointer(this.getNextIndAfterPointer(ind + 1)));
            case 4:
                return this.getLiteralPointer(this.getLiteralPointer(ind + 1));
            case 5:
                return ind + 1;
            case 6:
                return this.width - 1;
            case 7:
                return this.width * (this.height - 1);
            case 8:
                return (this.width * this.height) - 1;
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
            // case 13:
                // return this.getLiteralPointer(this.getThreadPointerInd());
            case 14:
                return this.getLiteralPointer(this.getLiteralPointer(this.getThreadPointerInd()));
            // case 15: {
            // case 16: {
            // case 17: {
            case 19: {
                return this.coordsToInd(this.colorToInt(this.readPointer(ind + 1)), this.colorToInt(this.readPointer(this.getNextIndAfterPointer(ind + 1))));
            }
            // case 20: {
            // case 21: {
            case 23: {
                return this.getLiteralPointer(this.getNextIndAfterPointer(this.getLiteralPointer(this.getThreadPointerInd())));
            }
            case 24: {
                return this.getLiteralPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getLiteralPointer(this.getThreadPointerInd()))));
            }
            case 25: {
                return this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getThreadPointerInd()))) + this.colorToInt(this.readPointer(ind + 1));
            }
            case 26: {
                return this.getLiteralPointer(this.getNextIndAfterPointer(this.getLiteralPointer(this.getThreadPointerInd()))) + this.colorToInt(this.readPointer(ind + 1));
            }
            case 27: {
                return this.getLiteralPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getLiteralPointer(this.getThreadPointerInd())))) - this.colorToInt(this.readPointer(ind + 1));
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
                return COLOR_ZERO;
            case 1:
                return COLOR_ONE;
            case 2:
                return COLOR_WHITE;
            case 4:
                return this.readPointer(this.getLiteralPointer(ind + 1))
            case 6:
                return this.intToColor(this.width);
            case 7:
                return this.intToColor(this.height);
            case 8:
                return this.intToColor(this.width * this.height);
            case 512: return this.intToColor(this.numberToFloat24(0));
            case 513: return this.intToColor(this.numberToFloat24(-0.0));
            case 514: return this.intToColor(INF_24_REPR);
            case 515: return this.intToColor(NEG_INF_24_REPR);
            case 516: return this.intToColor(this.numberToFloat24(1));
            case 517: return this.intToColor(this.numberToFloat24(-1));
            case 518: return this.intToColor(BIGGEST_SAFE_INT_24);
            case 519: return this.intToColor(BIGGEST_24);
            case 520: return this.intToColor(SMALLEST_NORMAL_24);
            case 521: return this.intToColor(this.numberToFloat24(Math.PI));
            case 522: return this.intToColor(this.numberToFloat24(Math.E));
            case 523: return this.intToColor(this.numberToFloat24(Math.SQRT2));
            case 524: return this.intToColor(this.numberToFloat24(Math.SQRT1_2));
            case 525: return this.intToColor(this.numberToFloat24(Math.sqrt(3)));
            case 526: return this.intToColor(this.numberToFloat24(1.61803398875));
            case 527: return this.intToColor(this.numberToFloat24(0.5772156649));
            case 3:
            case 5:
            case 9:
            case 10:
            case 11:
            case 12:
            // case 13:
            case 14:
            // case 15:
            // case 16:
            // case 17:
            case 19:
            // case 20:
            // case 21:
            case 23:
            case 24:
            case 25:
            case 26:
            case 27:
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
            case 512:
            case 513:
            case 514:
            case 515:
            case 516:
            case 517:
            case 518:
            case 519:
            case 520:
            case 521:
            case 522:
            case 523:
            case 524:
            case 525:
            case 526:
            case 527:
            default:
                return;
            case 3:
            case 5:
            case 9:
            case 10:
            case 11:
            case 12:
            // case 13:
            case 14:
            // case 15:
            // case 16:
            // case 17:
            case 19:
            case 20:
            case 21:
            case 23:
            case 24:
            case 25:
            case 26:
            case 27:
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
        this.writePointerToInd(this.getLiteralPointer(threadPointerInd), newInd);
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

        let exponent = 0;
        while ((x >= 2 || x < 1) && exponent > -BIAS_24 + 1) {
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
        x *= 2**17;
        x = Math.round(x);
        while (x >> 17 >= 1) {
            if (exponent >= BIAS_24) {
                return INF_24_REPR | output;
            }
            x >>= 1
            exponent += 1
        }
        return output | ((exponent + BIAS_24) << 17) | (x & 0x1FFFF);
    }

    float24ToNumber(x: number) {
        let exponent = (x >> 17) & 0b11_1111;
        let fraction = x & 0x1FFFF;
        let sign = -2*((x >> 23) & 1) + 1;
        if (exponent === 0b11_1111) {
            if (fraction != 0) {
                return NaN;
            }
            if (sign === -1) {
                return Number.NEGATIVE_INFINITY;
            }
            return Number.POSITIVE_INFINITY;
        }
        fraction /= 2**17
        if (exponent === 0) {
            return fraction;
        }
        exponent -= BIAS_24;
        fraction += 1;
        return sign * fraction * (2**exponent);
    }

    numberToFloat48(x: number) {
        let output = 0n;
        if (Number.isNaN(x)) {
            return NAN_48_REPR;
        }
        if (x > BIGGEST_48) {
            return INF_48_REPR;
        }
        if (x < -BIGGEST_48) {
            return NEG_INF_48_REPR;
        }
        if (x < 0 || Object.is(x, -0.0)) {
            output |= 1n << 47n;
        }
        x = Math.abs(x);

        let exponent = 0;
        while ((x >= 2 || x < 1) && exponent > -BIAS_48 + 1) {
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
        x *= 2**37;
        x = Math.round(x);
        while (x / 2**37 >= 1) {
            if (exponent >= BIAS_48) {
                return INF_48_REPR + Number(output);
            }
            x = Math.floor(x/2);
            exponent += 1;
        }
        return Number(output) + ((exponent + BIAS_48) * 2**37) + Number(BigInt(x) & 0x1FFFFFFFFFn);
    }

    float48ToNumber(x: number) {
        let xInt = BigInt(x);
        let exponent = (xInt >> 37n) & 0b11_1111_1111n;
        let fraction = Number(xInt & 0x1FFFFFFFFFn);
        let sign = -2*Number((xInt >> 47n) & 1n) + 1;
        if (exponent === 0b11_1111_1111n) {
            if (fraction != 0) {
                return NaN;
            }
            if (sign === -1) {
                return Number.NEGATIVE_INFINITY;
            }
            return Number.POSITIVE_INFINITY;
        }
        fraction /= 2**37;
        if (exponent === 0n) {
            return fraction;
        }
        exponent -= BigInt(BIAS_48);
        fraction += 1;
        return sign * fraction * (2**Number(exponent));
    }

    step(verbose: boolean) {
        let versionPixel = this.getPixel(0);
        if (versionPixel.r != 0 || versionPixel.g != 0 || versionPixel.b != 2) {return;} // return if not version 2
        for (this.threadIndex = 0; this.threadIndex < this.colorToInt(this.getPixel(2)); this.threadIndex++) {
            let threadPointerInd = this.getThreadPointerInd();
            let executionPointer = this.getLiteralPointer(this.getLiteralPointer(threadPointerInd));
            let inputStackBottom = this.getLiteralPointer(this.getNextIndAfterPointer(this.getLiteralPointer(threadPointerInd)));
            let inputStackTop = this.getLiteralPointer(this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getLiteralPointer(threadPointerInd))));
            let opcode = this.colorToInt(this.getPixel(executionPointer));
            let argumentPointer = executionPointer + 1;
            let inputColors: Array<RGB> = [];
            let inputNums: Array<number> = []; // ints, floats, pointers
            let inputBools: Array<boolean> = [];
            let outputColors = [];
            let outputNums: Array<number | undefined> = []; // ints, floats, pointers
            let outputBools: Array<boolean | undefined> = [];
            let inputFlags: Array<Array<string>> = [];
            let argumentPointers: Array<number> = [];
            let outputStackBottom: number | undefined = undefined;
            let outputStackTop: number | undefined = undefined;
            let next: number | undefined = undefined;


            let instruction: InstructionType
            if (Object.hasOwn(INSTRUCTIONS, opcode)) {
                instruction = INSTRUCTIONS[opcode];
            } else {
                if (verbose) {
                    console.log("undefined operation");
                }
                return;
            }

            instruction.arguments.forEach((argument) => {
                let inputFlagsCur = [];
                if (argument.includes("color")) {
                    inputColors.push(this.readPointer(argumentPointer));
                }
                if (argument.includes("int")) {
                    inputNums.push(this.colorToInt(this.readPointer(argumentPointer)));
                    if (inputNums[-1] == 0) {
                        inputFlagsCur.push("zero");
                    }
                    if (inputNums[-1] < 0) {
                        inputFlagsCur.push("negative");
                    }
                }
                if (argument.includes("bool")) {
                    inputBools.push(this.colorToInt(this.readPointer(argumentPointer)) != 0);
                }
                if (argument.includes("float24")) {
                    inputNums.push(this.float24ToNumber(this.colorToInt(this.readPointer(argumentPointer))));
                    if (Number.isNaN(inputNums[-1])) {
                        inputFlagsCur.push("nan")
                    }
                    else if (!Number.isFinite(inputNums[-1])) {
                        inputFlagsCur.push("infinite");
                    }
                    if (inputNums[-1] == 0) {
                        inputFlagsCur.push("zero");
                    }
                    if (inputNums[-1] < 0) {
                        inputFlagsCur.push("negative");
                    }
                }
                if (argument.includes("pointer")) {
                    inputNums.push(this.getLiteralPointer(argumentPointer));
                }

                if (argument.includes("outputColor")) {
                    outputColors.push(undefined);
                }
                if (argument.includes("outputInt") || argument.includes("outputFloat24") || argument.includes("outputPointer")) {
                    outputNums.push(undefined);
                }
                if (argument.includes("outputBool")) {
                    outputBools.push(undefined);
                }
                inputFlags.push(inputFlagsCur);
                argumentPointers.push(argumentPointer);
                argumentPointer = this.getNextIndAfterPointer(argumentPointer);
            });

            let doInstruction = true;
            instruction.rules.forEach((rule) => {
                rule.arguments.forEach((argument) => {
                    if (rule.rule == "NaNifNaN") {
                        if (inputFlags[argument].includes("nan")) {
                            outputNums.fill(NaN); // TDOD: make NaNs carry over hidden data
                            doInstruction = false;
                        }
                    }
                    if (rule.rule == "NaNif0") {
                        if (inputFlags[argument].includes("zero")) {
                            outputNums.fill(NaN);
                            doInstruction = false;
                        }
                    }
                    if (rule.rule == "NaNifNegative") {
                        if (inputFlags[argument].includes("negative")) {
                            outputNums.fill(NaN);
                            doInstruction = false;
                        }
                    }
                    if (rule.rule == "falseIfNaN") {
                        if (inputFlags[argument].includes("nan")) {
                            outputBools.fill(false);
                            doInstruction = false;
                        }
                    }
                    if (rule.rule == "0IfNaN") {
                        if (inputFlags[argument].includes("nan")) {
                            outputNums.fill(0);
                            doInstruction = false;
                        }
                    }
                    if (rule.rule == "0IfInfinite") {
                        if (inputFlags[argument].includes("infinite")) {
                            outputNums.fill(0);
                            doInstruction = false;
                        }
                    }
                });
            });

            if (doInstruction) {
                switch (opcode) {
                    default:
                    case 0: 
                    case 1: break;
                    case 2: outputColors[0] = inputColors[0]; break;
                    case 3:
                        outputColors[0] = inputColors[1];
                        outputColors[1] = inputColors[0];
                        break;
                    case 6:
                        if (inputBools[0]) {next = inputNums[0];}
                        break;
                    case 7:
                        if (inputBools[0]) {next = inputNums[0];}
                        else {next = inputNums[1];}
                        break;
                    case 8: next = inputNums[0]; break;
                    case 514:
                    case 9: outputNums[0] = inputNums[0] + inputNums[1]; break;
                    case 515:
                    case 10: outputNums[0] = inputNums[0] - inputNums[1]; break;
                    case 516:
                    case 11: outputNums[0] = inputNums[0] * inputNums[1]; break;
                    case 517: outputNums[0] = inputNums[0] / inputNums[1]; break;
                    case 12: outputNums[0] = Math.trunc(inputNums[0] / inputNums[1]); break;
                    case 518:
                    case 13: outputNums[0] = truemod(inputNums[0], inputNums[1]); break;
                    case 519:
                    case 14: outputNums[0] = -inputNums[0]; break;
                    case 15: outputNums[0] = inputNums[0] << inputNums[1]; break;
                    case 16: outputNums[0] = (inputNums[0] >> inputNums[1]) & ((1 << (24-inputNums[1])) - 1); break;
                    case 17:
                        outputNums[0] = inputNums[0] << inputNums[1];
                        outputNums[1] = (inputNums[0] >> (24-inputNums[1])) & ((1 << (24-inputNums[1])) - 1);
                        break;
                    case 18:
                        outputNums[0] = (inputNums[0] >> inputNums[1]) & ((1 << (24-inputNums[1])) - 1);
                        outputNums[1] = inputNums[0] << (24-inputNums[1]);
                        break;
                    case 19: {
                        let a = inputNums[0] << inputNums[1];
                        let b = (inputNums[0] >> (24-inputNums[1])) & ((1 << (24-inputNums[1])) - 1);
                        outputNums[0] = a | b;
                        break;
                    }
                    case 20: {
                        let a = (inputNums[0] >> inputNums[1]) & ((1 << (24-inputNums[1])) - 1);
                        let b = inputNums[0] << (24-inputNums[1]);
                        outputNums[0] = a | b;
                        break;
                    }
                    case 21:
                        outputNums[0] = inputColors[0].r;
                        outputNums[1] = inputColors[0].g;
                        outputNums[2] = inputColors[0].b;
                        break;
                    case 520:
                    case 22: outputNums[0] = Math.max(inputNums[0], inputNums[1]); break;
                    case 521:
                    case 23: outputNums[0] = Math.min(inputNums[0], inputNums[1]); break;
                    case 522:
                    case 24: outputNums[0] = Math.abs(inputNums[0]); break;
                    case 25: outputNums[0] = ~inputNums[0]; break;
                    case 26: outputNums[0] = inputNums[0] | inputNums[1]; break;
                    case 27: outputNums[0] = inputNums[0] & inputNums[1]; break;
                    case 28: outputNums[0] = inputNums[0] ^ inputNums[1]; break;
                    case 29: outputNums[0] = ~(inputNums[0] | inputNums[1]); break;
                    case 30: outputNums[0] = ~(inputNums[0] & inputNums[1]); break;
                    case 31: outputNums[0] = ~(inputNums[0] ^ inputNums[1]); break;
                    case 523:
                    case 32: outputBools[0] = inputNums[0] == inputNums[1]; break;
                    case 524:
                    case 33: outputBools[0] = inputNums[0] != inputNums[1]; break;
                    case 525:
                    case 34: outputBools[0] = inputNums[0] < inputNums[1]; break;
                    case 526:
                    case 35: outputBools[0] = inputNums[0] > inputNums[1]; break;
                    case 527:
                    case 36: outputBools[0] = inputNums[0] <= inputNums[1]; break;
                    case 528:
                    case 37: outputBools[0] = inputNums[0] >= inputNums[1]; break;
                    case 38: outputColors[0] = inputBools[0]? inputColors[0] : inputColors[1]; break;
                    case 39: outputBools[0] = !inputBools[0]; break;
                    case 40: outputBools[0] = inputBools[0] || inputBools[1]; break;
                    case 41: outputBools[0] = inputBools[0] && inputBools[1]; break;
                    case 42: outputBools[0] = (inputBools[0] || inputBools[1]) && !(inputBools[0] && inputBools[1]); break;
                    case 43: outputBools[0] = !(inputBools[0] || inputBools[1]); break;
                    case 44: outputBools[0] = !(inputBools[0] && inputBools[1]); break;
                    case 45: outputBools[0] = (inputBools[0] && inputBools[1]) || !(inputBools[0] || inputBools[1]); break;
                    case 46: outputBools[0] = inputBools[0]; break;
                    case 512:
                        outputNums[0] = inputNums[0];
                        if (!Number.isFinite(outputNums[0])) {outputNums[0] = 0}
                        break;
                    case 513:
                    case 47: outputNums[0] = inputNums[0]; break;
                    case 48: outputNums[0] = this.getNextIndAfterPointer(inputNums[0]); break;
                    case 49:
                        if (!inputBools[0]) {next = inputNums[0];}
                        break;
                    case 50:
                        if (inputBools[0]) {next = executionPointer;}
                        break;
                    case 51:
                        if (!inputBools[0]) {next = executionPointer;}
                        break;
                    case 52:
                        if (inputColors[0] == inputColors[1]) {next = executionPointer;}
                        break;
                    case 53:
                        this.writePointerToInd(inputStackTop+1, inputStackBottom);
                        outputStackBottom = inputStackTop+1;
                        outputStackTop = inputStackTop + 2;
                        break;
                    case 54:
                        this.writePointerToInd(inputStackBottom+1, argumentPointer);
                        next = inputNums[0];
                        outputStackBottom = inputStackBottom + 2;
                        break;
                    case 55:
                        this.writePointerToInd(inputStackTop+1, inputStackBottom);
                        this.writePointerToInd(inputStackTop+2, argumentPointer);
                        next = inputNums[0];
                        outputStackBottom = inputStackTop + 3;
                        outputStackTop = inputStackTop + 2;
                        break;
                    case 57:
                        this.drawPixel(inputStackBottom, inputColors[0]);
                    case 56:
                        outputStackBottom = this.getLiteralPointer(inputStackBottom-2);
                        next = this.getLiteralPointer(inputStackBottom-1);
                        break;
                    case 58:
                        this.drawPixel(inputStackTop+1, inputColors[0]);
                    case 60:
                        outputStackTop = inputStackTop + 1;
                        break;
                    case 59:
                        this.writePointerToInd(inputStackTop+1, inputNums[0]);
                        outputStackTop = inputStackTop + 1;
                        break;
                    case 61:
                        outputColors[0] = this.getPixel(inputStackTop);
                    case 63:
                        outputStackTop = inputStackTop - 1;
                        break;
                    case 62:
                        this.writePointerToInd(inputNums[0], this.getLiteralPointer(inputStackTop));
                        outputStackTop = inputStackTop - 1;
                        break;

                    case 529: outputBools[0] = (Object.is(inputNums[0], inputNums[1])); break;
                    case 530: outputBools[0] = (inputNums[0] < 0.0) || Object.is(inputNums[0], -0.0); break;
                    case 531: outputBools[0] = Number.isFinite(inputNums[0]); break;
                    case 532: outputBools[0] = Number.isNaN(inputNums[0]); break;
                    case 533: outputNums[0] = Math.floor(inputNums[0]); break;
                    case 534: outputNums[0] = Math.ceil(inputNums[0]); break;
                    case 535: outputNums[0] = Math.trunc(inputNums[0]); break;
                    case 536: outputNums[0] = Math.round(inputNums[0]); break;
                    case 537: outputNums[0] = Math.round(inputNums[0] * inputNums[1]) / inputNums[1]; break;
                    case 538: outputNums[0] = 1 / inputNums[0]; break;
                    case 539: outputNums[0] = Math.pow(inputNums[0], inputNums[1]); break;
                    case 540: outputNums[0] = Math.sqrt(inputNums[0]); break;
                    case 541: outputNums[0] = Math.exp(inputNums[0]); break;
                    case 542: outputNums[0] = Math.pow(2, inputNums[0]); break;
                    case 543: outputNums[0] = Math.pow(10, inputNums[0]); break;
                    case 544: outputNums[0] = Math.log(inputNums[0]); break;
                    case 545: outputNums[0] = Math.log2(inputNums[0]); break;
                    case 546: outputNums[0] = Math.log10(inputNums[0]); break;
                    case 547: outputNums[0] = Math.log(inputNums[0]) / Math.log(inputNums[1]); break;
                    case 548: outputNums[0] = inputNums[0]*Math.PI/180; break;
                    case 549: outputNums[0] = inputNums[0]*180/Math.PI; break;
                    case 550: outputNums[0] = truemod(inputNums[0], (2*Math.PI)); break;
                    case 551: outputNums[0] = Math.sin(inputNums[0]); break;
                    case 552: outputNums[0] = Math.cos(inputNums[0]); break;
                    case 553: outputNums[0] = Math.tan(inputNums[0]); break;
                    case 554: outputNums[0] = 1 / Math.cos(inputNums[0]); break;
                    case 555: outputNums[0] = 1 / Math.sin(inputNums[0]); break;
                    case 556: outputNums[0] = Math.cos(inputNums[0]) / Math.sin(inputNums[0]); break;
                    case 557: outputNums[0] = Math.asin(inputNums[0]); break;
                    case 558: outputNums[0] = Math.acos(inputNums[0]); break;
                    case 559: outputNums[0] = Math.atan(inputNums[0]); break;
                    case 560: outputNums[0] = Math.acos(1 / inputNums[0]); break;
                    case 561: outputNums[0] = Math.asin(1 / inputNums[0]); break;
                    case 562: outputNums[0] = -Math.atan(inputNums[0]) + (Math.PI/2); break;
                    case 563: outputNums[0] = Math.atan2(inputNums[0], inputNums[1]); break;
                    case 564: outputNums[0] = Math.sinh(inputNums[0]); break;
                    case 565: outputNums[0] = Math.cosh(inputNums[0]); break;
                    case 566: outputNums[0] = Math.tanh(inputNums[0]); break;
                    case 567: outputNums[0] = 1 / Math.cosh(inputNums[0]); break;
                    case 568: outputNums[0] = 1 / Math.sinh(inputNums[0]); break;
                    case 569: outputNums[0] = Math.cosh(inputNums[0]) / Math.sinh(inputNums[0]); break;
                    case 570: outputNums[0] = Math.asinh(inputNums[0]); break;
                    case 571: outputNums[0] = Math.acosh(inputNums[0]); break;
                    case 572: outputNums[0] = Math.atanh(inputNums[0]); break;
                    case 573: outputNums[0] = Math.acosh(1 / inputNums[0]); break;
                    case 574: outputNums[0] = Math.asinh(1 / inputNums[0]); break;
                    case 575: outputNums[0] = Math.atanh(1 / inputNums[0]); break;
                    case 576: outputNums[0] = inputNums[2]*(inputNums[1] - inputNums[0]) + inputNums[0]; break;
                    case 577: outputNums[0] = inputNums[0]*inputNums[1] + inputNums[2]; break;
                }
            }

            if (next != undefined) {
                this.moveExecutionPointer(threadPointerInd, next);
            } else {
                this.moveExecutionPointer(threadPointerInd, argumentPointer);
            }

            if (outputStackBottom != undefined) {
                this.writePointerToInd(this.getNextIndAfterPointer(this.getLiteralPointer(threadPointerInd)), outputStackBottom);
            }

            if (outputStackTop != undefined) {
                this.writePointerToInd(this.getNextIndAfterPointer(this.getNextIndAfterPointer(this.getLiteralPointer(threadPointerInd))), outputStackTop);
            }

            let outputColorInd = 0;
            let outputNumInd = 0;
            let outputBoolInd = 0;
            instruction.arguments.forEach((argument, index) => {
                if (argument.includes("outputColor")) {
                    this.writePointer(argumentPointers[index], outputColors[outputColorInd]!);
                    outputColorInd++;
                }
                if (argument.includes("outputInt")) {
                    this.writePointer(argumentPointers[index], this.intToColor(outputNums[outputNumInd]!));
                    outputNumInd++;
                }
                if (argument.includes("outputFloat24")){
                    this.writePointer(argumentPointers[index], this.intToColor(this.numberToFloat24(outputNums[outputNumInd]!)));
                    outputNumInd++;
                }
                if (argument.includes("outputPointer")) {
                    this.writePointerToInd(this.getLiteralPointer(argumentPointers[index]!), outputNums[outputNumInd]!);
                    outputNumInd++;
                }
                if (argument.includes("outputBool")) {
                    this.writePointer(argumentPointers[index], outputBools[outputBoolInd]? COLOR_WHITE : COLOR_ZERO);
                    outputBoolInd++;
                }
            });

            if (verbose) {
                console.log(opcode, instruction.mnemonic);
            }
        }
        this.commitPending();
    }

    compile(s: string) {
        /*
        [
            Math.PI,
            Math.E,
            Math.SQRT2,
            Math.SQRT1_2,
            Math.sqrt(3),
            (1+Math.sqrt(5))/2,
            0.57721566490153286060651209008240243104215933593992
        ].forEach((value) => {
            console.log(value, value-this.float24ToNumber(this.numberToFloat24(value)), value-this.float48ToNumber(this.numberToFloat48(value)));
        })
        */
        draw(s, this);
    }
}