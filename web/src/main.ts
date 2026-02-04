import { SimulationEngine } from "./simulation.ts";
import { RotorArrayVisualizer } from "./visualizer.ts";
import { ControlPanel, MeanDirectionVisualizer, OrderPlot } from "./ui.ts";
import { generateInitialState } from "./presets.ts";

const canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
const mdCanvas = document.getElementById("mean-dir-canvas") as HTMLCanvasElement;

const visualizer = new RotorArrayVisualizer(canvas);
const mdViz = new MeanDirectionVisualizer(mdCanvas);
const plot = new OrderPlot("uplot-chart");
const controls = new ControlPanel("controls-container");

let engine: SimulationEngine | null = null;
let running = false;
let timeScale = 1.0;

let lastFrame = 0;
const loop = (timestamp: number) => {
    const dt = (timestamp - lastFrame) / 1000;
    lastFrame = timestamp;
    
    const safeDt = Math.min(dt, 0.1);
    
    if (engine) {
        if (running) {
             engine.step(safeDt * timeScale);
             
             const op = engine.getOrderParameter();
             plot.push(engine.t, op.r);
             mdViz.update(op.r, op.meanCos, op.meanSin);
        }
        
        // Handle resizing and rendering
        visualizer.setLSide(engine.params.lSide);
        visualizer.update(engine.theta, engine.omega, controls.arrowCheck.checked);
    }
    
    requestAnimationFrame(loop);
};

controls.onReset = (preset, k, p2, p3, temp) => {
    const l = parseInt(controls.lInput.value) || 20;
    
    const params = {
        lSide: l,
        jCoupling: parseFloat(controls.jInput.value) / 100,
        mField: parseFloat(controls.mInput.value) / 100
    };
    
    engine = new SimulationEngine(params);
    const { theta, omega } = generateInitialState(l, preset, k, p2, p3, temp);
    engine.setState(theta, omega);
    
    timeScale = parseFloat(controls.timeInput.value) / 100;
    
    plot.reset();
    running = false;
    controls.isRunning = false;
    controls.startBtn.textContent = "Start";
    controls.startBtn.classList.remove("active");
    controls.toggleInputs(true);
};

controls.onParamChange = (j, m, t) => {
    timeScale = t;
    if (engine) {
        engine.updateParams(j, m);
    }
};

controls.onStartStop = (r) => {
    running = r;
};

// Start loop
requestAnimationFrame(loop);

// Initial Trigger to load default state
// We wrap in setTimeout to ensure UI is fully rendered/sized
setTimeout(() => {
    controls.triggerReset();
}, 100);