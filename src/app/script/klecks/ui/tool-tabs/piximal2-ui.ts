import { BB } from '../../../bb/bb';
import { KL } from '../../kl';
import { StatusOverlay } from '../components/status-overlay';
import { KlCanvas, TKlCanvasLayer } from '../../canvas/kl-canvas';
import { LANG } from '../../../language/language';
import { KlColorSlider } from '../components/kl-color-slider';
import { LayersUi } from './layers-ui/layers-ui';
import { RGB } from '../../../bb/color/color';
import { getSharedFx } from '../../../fx-canvas/shared-fx';
import { KlHistory } from '../../history/kl-history';
import stepImg from 'url:/src/app/img/ui/piximal2-step.svg';
import compileImg from 'url:/src/app/img/ui/piximal2-compile.svg';
import runImg from 'url:/src/app/img/ui/piximal2-run.svg';
import stopImg from 'url:/src/app/img/ui/piximal2-stop.svg';
import { Piximal2 } from '../../piximal2/piximal2';
import { PointerListener } from '../../../bb/input/pointer-listener';
import { createMatrixFromTransform } from '../../../bb/transform/create-matrix-from-transform';
import { applyToPoint, inverse } from 'transformation-matrix';

export type TPiximal2UiParams = {
    klRootEl: HTMLElement;
    klColorSlider: KlColorSlider;
    layersUi: LayersUi;
    getCurrentColor: () => RGB;
    maxCanvasSize: number;
    klCanvas: KlCanvas;
    getCurrentLayer: () => TKlCanvasLayer;
    isEmbed: boolean;
    statusOverlay: StatusOverlay;
    onCanvasChanged: () => void; // dimensions/orientation changed
    applyUncommitted: () => void;
    klHistory: KlHistory;
    onCopyToClipboard: () => void;
    onPaste: () => void;
    piximal2: Piximal2
};

const createButtonContent = (text: string, icon: string, noInvert?: boolean): string => {
    return `<img ${noInvert ? 'class="dark-no-invert"' : ''} src='${icon}' alt='icon' height='20'/>${text}`;
};

export class Piximal2Ui {
    // from params
    private readonly klRootEl: HTMLElement;
    private readonly klColorSlider: KlColorSlider;
    private readonly layersUi: LayersUi;
    private readonly getCurrentColor: () => RGB;
    private readonly maxCanvasSize: number;
    private readonly klCanvas: KlCanvas;
    private readonly getCurrentLayer: () => TKlCanvasLayer;
    private readonly isEmbed: boolean;
    private readonly statusOverlay: StatusOverlay;
    private readonly onCanvasChanged: () => void; // dimensions/orientation changed
    private readonly applyUncommitted: () => void;
    private readonly klHistory: KlHistory;
    private readonly onCopyToClipboard: () => void;
    private readonly onPaste: () => void;
    private readonly piximal2;
    private running: boolean = false;
    private stepButton: HTMLButtonElement | undefined;
    private runButton: HTMLButtonElement | undefined;
    private stopButton: HTMLButtonElement | undefined;
    private compileButton: HTMLButtonElement | undefined;
    private sourceBox: HTMLTextAreaElement | undefined;
    private pixelInfo: HTMLParagraphElement | undefined;
    private pointerListener: PointerListener | undefined;

    private readonly rootEl: HTMLDivElement;
    private isInit = false;

    private testHasWebGL(): boolean {
        return !!getSharedFx();
    }

    private async loop(): Promise<void> {
        this.running = true;
        let iter = 0;
        while (this.running) {
            this.piximal2. /* this is a really weird place to put a comment */ step(false);
            if (iter == 500) {
                this.piximal2.requestRender();
                iter = 0;
                await new Promise(r => setTimeout(r, 0));
            } else {
                iter++;
            }
        }
    }

    private getPointInfo(x: number, y: number): string {
        if (x < 0 || x >= this.piximal2.getWidth() || y < 0 || y >= this.piximal2.getHeight()) {
            return "";
        }
        let ind = this.piximal2.coordsToInd(x, y);
        let color = this.piximal2.getPixel(ind);
        let int = this.piximal2.colorToInt(color);
        let literal = this.piximal2.getLiteralPointer(ind);
        return `(${x}, ${y})<br>index: ${ind}<br>color: ${color.r}, ${color.g}, ${color.b}<br>hex: ${int.toString(16)}<br>dec: ${int}<br>pointer: ${literal}`;
    }

    private init(): void {
        const filters = KL.FILTER_LIB;
        const buttons = [];

        if (!KL.FILTER_LIB_STATUS.isLoaded) {
            throw new Error('filters not loaded');
        }

        const hasWebGL: boolean = this.testHasWebGL();

        if (!hasWebGL) {
            const note = BB.el({
                parent: this.rootEl,
                className: 'kl-toolspace-note',
                content: 'Features disabled because WebGL is failing.',
                css: {
                    margin: '10px',
                    marginBottom: '0',
                },
            });
            const noteButton = BB.el({
                parent: note,
                tagName: 'button',
                textContent: 'Learn More',
                css: {
                    marginLeft: '5px',
                },
            });
            noteButton.onclick = () => {
                KL.popup({
                    target: this.klRootEl,
                    message: '<b>WebGL is not working</b>',
                    div: BB.el({
                        content: `
See if your browser supports WebGL and has it enabled: <a href="https://get.webgl.org" target="_blank" rel="noopener noreferrer">get.webgl.org</a><br>
<br>
Recently (2023-05) a number of Chrome users on Chrome OS reported that WebGL fails, although it is enabled & supported.
This has been reported to Google.
`,
                    }),
                    buttons: ['Ok'],
                    clickOnEnter: 'Ok',
                });
            };
        }

        this.stepButton = BB.el({
            tagName: 'button',
            className: 'grid-button',
            content: createButtonContent(LANG('piximal2-step'), stepImg, false),
            custom: {
                tabIndex: '-1',
            },
            css: {
                cssFloat: 'left',
            },
            onClick: () => {
                this.piximal2.step(true);
                this.piximal2.pushHistory();
                this.piximal2.requestRender();
            }
        });

        this.compileButton = BB.el({
            tagName: 'button',
            className: 'grid-button',
            content: createButtonContent(LANG('piximal2-compile'), compileImg, false),
            custom: {
                tabIndex: '-1',
            },
            css: {
                cssFloat: 'left',
            },
            onClick: () => {
                this.piximal2.compile(this.sourceBox!.value);
                this.piximal2.pushHistory();
                this.piximal2.requestRender();
            }
        });

        this.runButton = BB.el({
            tagName: 'button',
            className: 'grid-button',
            content: createButtonContent(LANG('piximal2-run'), runImg, false),
            custom: {
                tabIndex: '-1',
            },
            css: {
                cssFloat: 'left',
            },
            onClick: () => {
                this.rootEl.replaceChild(this.stopButton!, this.rootEl.childNodes[2]);
                this.loop()
            }
        });

        this.stopButton = BB.el({
            tagName: 'button',
            className: 'grid-button',
            content: createButtonContent(LANG('piximal2-stop'), stopImg, false),
            custom: {
                tabIndex: '-1',
            },
            css: {
                cssFloat: 'left',
            },
            onClick: () => {
                this.running = false;
                this.piximal2.requestRender();
                this.piximal2.pushHistory();
                this.rootEl.replaceChild(this.runButton!, this.rootEl.childNodes[2]);
            }
        });

        this.sourceBox = BB.el({
            tagName: 'textarea',
            content: "",
            custom: {
                placeholder: LANG('text-placeholder'),
            },
            css: {
                whiteSpace: 'pre',
                overflow: 'auto',
                margin: "10px",
                width: '251px',
                height: '150px',
                resize: "none"
            }
        });

        this.pixelInfo = BB.el({
            tagName: "p",
            content: "",
            css: {
                width: "251px",
                margin: "10px"
            }
        })

        this.sourceBox!.addEventListener("focusin", (e) => KL.DIALOG_COUNTER.increase());
        this.sourceBox!.addEventListener("focusout", (e) => KL.DIALOG_COUNTER.decrease());

        BB.append(this.rootEl, [this.stepButton, this.compileButton, this.runButton, this.sourceBox, this.pixelInfo]);

        this.pointerListener = new PointerListener({
            target: this.piximal2.easel.getElement(),
            onPointer: (e) => {
                const mat = createMatrixFromTransform(this.piximal2.easel.getTransform());
                let canvasPoint = applyToPoint(inverse(mat), [e.relX, e.relY]);
                canvasPoint = [Math.floor(canvasPoint[0]), Math.floor(canvasPoint[1])];
                if (this.pixelInfo != null) {
                    this.pixelInfo.innerHTML = this.getPointInfo(canvasPoint[0], canvasPoint[1]);
                }
            }
        });

        this.isInit = true;
    }

    // ----------------------------------- public -----------------------------------

    constructor(p: TPiximal2UiParams) {
        this.klRootEl = p.klRootEl;
        this.klColorSlider = p.klColorSlider;
        this.layersUi = p.layersUi;
        this.getCurrentColor = p.getCurrentColor;
        this.maxCanvasSize = p.maxCanvasSize;
        this.klCanvas = p.klCanvas;
        this.getCurrentLayer = p.getCurrentLayer;
        this.isEmbed = p.isEmbed;
        this.statusOverlay = p.statusOverlay;
        this.onCanvasChanged = p.onCanvasChanged;
        this.applyUncommitted = p.applyUncommitted;
        this.klHistory = p.klHistory;
        this.onCopyToClipboard = p.onCopyToClipboard;
        this.onPaste = p.onPaste;
        this.piximal2 = p.piximal2;
        this.piximal2.setHistory(this.klHistory);

        this.rootEl = BB.el();
    }

    getElement(): HTMLElement {
        return this.rootEl;
    }

    show(): void {
        if (!this.isInit) {
            this.init();
        }
        this.rootEl.style.display = 'block';
    }

    hide(): void {
        this.rootEl.style.display = 'none';
    }

    hasFocusedTextbox(): boolean {
        if (this.sourceBox === document.activeElement) {
            return true;
        }
        return false;
    }
}
