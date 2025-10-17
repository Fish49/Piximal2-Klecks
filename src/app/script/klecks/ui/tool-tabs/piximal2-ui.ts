import { BB } from '../../../bb/bb';
import { KL } from '../../kl';
import { IKeyString } from '../../../bb/bb-types';
import { StatusOverlay } from '../components/status-overlay';
import { KlCanvas, TKlCanvasLayer } from '../../canvas/kl-canvas';
import { LANG } from '../../../language/language';
import { IFilterApply, IFilterGetDialogParam, TFilterGetDialogResult } from '../../kl-types';
import { KlColorSlider } from '../components/kl-color-slider';
import { LayersUi } from './layers-ui/layers-ui';
import { RGB } from '../../../bb/color/color';
import { getSharedFx } from '../../../fx-canvas/shared-fx';
import { c } from '../../../bb/base/c';
import { KlHistory } from '../../history/kl-history';

export type TFilterUiParams = {
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

    private readonly rootEl: HTMLDivElement;
    private isInit = false;

    private testHasWebGL(): boolean {
        return !!getSharedFx();
    }

    constructor(p: TFilterUiParams) {
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

        this.rootEl = document.createElement('div');
    }

    private init(): void {
        const filters = KL.filterLib;
        const buttons = [];

        if (!KL.filterLibStatus.isLoaded) {
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

        const stepButton = document.createElement('button');

        this.isInit = true;
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
}
