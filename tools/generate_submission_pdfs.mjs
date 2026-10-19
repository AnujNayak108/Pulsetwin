import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { jsPDF } = require("jspdf");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsPath = resolve(root, "docs");
mkdirSync(docsPath, { recursive: true });

const colors = {
  ink: [31, 51, 52],
  muted: [101, 120, 116],
  green: [28, 121, 101],
  pale: [235, 246, 241],
  canvas: [247, 250, 248],
  line: [220, 231, 225],
  coral: [205, 112, 92],
  blue: [95, 117, 163],
  white: [255, 255, 255],
};

function setFont(doc, size, style = "normal", color = colors.ink) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

function writeWrapped(doc, text, x, y, width, size = 11, color = colors.muted, lineHeight = 1.35) {
  setFont(doc, size, "normal", color);
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, x, y, { lineHeightFactor: lineHeight });
  return y + lines.length * size * 0.36 * lineHeight;
}

function drawCard(doc, x, y, width, height, title, lines, accent = colors.green) {
  doc.setFillColor(...colors.white);
  doc.setDrawColor(...colors.line);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, width, height, 3, 3, "FD");
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 2.5, height, 1, 1, "F");
  setFont(doc, 12, "bold", colors.ink);
  doc.text(title, x + 7, y + 10);
  let lineY = y + 17;
  for (const line of lines) {
    lineY = writeWrapped(doc, line, x + 7, lineY, width - 13, 9, colors.muted, 1.25) + 2;
  }
}

function drawArrow(doc, x1, y1, x2, y2, label, labelX, labelY, dashed = false) {
  doc.setDrawColor(...colors.green);
  doc.setFillColor(...colors.green);
  doc.setLineWidth(0.9);
  doc.setLineDashPattern(dashed ? [2, 1.5] : [], 0);
  doc.line(x1, y1, x2, y2);
  doc.setLineDashPattern([], 0);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 2.6;
  const backX = x2 - Math.cos(angle) * size;
  const backY = y2 - Math.sin(angle) * size;
  const wing = size * 0.55;
  doc.triangle(
    x2,
    y2,
    backX + Math.cos(angle + Math.PI / 2) * wing,
    backY + Math.sin(angle + Math.PI / 2) * wing,
    backX + Math.cos(angle - Math.PI / 2) * wing,
    backY + Math.sin(angle - Math.PI / 2) * wing,
    "F",
  );
  if (label) {
    setFont(doc, 7.5, "bold", colors.green);
    doc.text(label, labelX, labelY);
  }
}

function drawArchitecture() {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFillColor(...colors.canvas);
  doc.rect(0, 0, 297, 210, "F");
  setFont(doc, 9, "bold", colors.green);
  doc.text("PULSETWIN  /  SYSTEM ARCHITECTURE", 15, 17);
  setFont(doc, 20, "bold", colors.ink);
  doc.text("Synthetic diabetes digital twin proof of concept", 15, 29);
  writeWrapped(
    doc,
    "Binaryspot  |  Birla Institute of Technology Mesra  |  Synthetic data only",
    15,
    37,
    260,
    9,
  );

  drawCard(doc, 15, 52, 66, 48, "Static synthetic EHR", [
    "Demographics and diagnoses",
    "Historical HbA1c and BMI",
    "Medication and patient context",
  ], colors.blue);
  drawCard(doc, 15, 119, 66, 50, "Simulated wearable", [
    "Glucose (mg/dL) and heart rate",
    "One real second = five simulated minutes",
    "Optional scripted excursion input",
  ], colors.coral);
  drawCard(doc, 107, 77, 72, 57, "FastAPI fusion layer", [
    "GET /api/patient serves the synthetic profile",
    "WS /ws/stream emits timestamped readings",
    "POST /api/inject-anomaly controls demo input",
  ]);
  drawCard(doc, 205, 48, 77, 72, "Explainable demo models", [
    "Current-input heuristic index with component breakdown",
    "12-sample linear glucose trend, projected 120 minutes",
    "Illustrative 180 mg/dL crossing flag",
    "Projected contextual index includes EHR and heart-rate context",
  ], colors.blue);
  drawCard(doc, 205, 139, 77, 43, "Clinician dashboard concept", [
    "Live trend and dashed projection",
    "Guided replay and counterfactual comparison",
    "Synthetic JSON/PDF snapshot export",
  ], colors.coral);

  drawArrow(doc, 81, 75, 107, 91, "profile", 86, 76);
  drawArrow(doc, 81, 143, 107, 119, "sensor stream", 83, 135);
  drawArrow(doc, 179, 104, 205, 86, "inputs + prediction", 181, 89);
  drawArrow(doc, 243, 120, 243, 139, "view", 247, 132);
  drawArrow(doc, 205, 161, 179, 126, "demo control", 179, 151, true);

  doc.setDrawColor(...colors.line);
  doc.line(15, 191, 282, 191);
  writeWrapped(
    doc,
    "Research demonstration only. The trend extrapolation and threshold are unvalidated project choices; not for diagnosis, treatment, or medication decisions.",
    15,
    199,
    267,
    8,
    colors.muted,
  );
  doc.save(resolve(docsPath, "architecture.pdf"));
}

function slideBase(doc, page, kicker, title, subtitle = "") {
  const width = 297;
  const height = 167;
  doc.setFillColor(...colors.canvas);
  doc.rect(0, 0, width, height, "F");
  setFont(doc, 8, "bold", colors.green);
  doc.text(kicker.toUpperCase(), 16, 15);
  setFont(doc, 21, "bold", colors.ink);
  doc.text(title, 16, 30);
  if (subtitle) writeWrapped(doc, subtitle, 16, 38, 263, 9, colors.muted);
  doc.setDrawColor(...colors.line);
  doc.line(16, 153, 281, 153);
  setFont(doc, 7, "normal", colors.muted);
  doc.text("Binaryspot  |  Synthetic proof of concept  |  Not for clinical use", 16, 160);
  doc.text(String(page).padStart(2, "0"), 280, 160, { align: "right" });
}

function slideBullet(doc, text, x, y, width, color = colors.muted) {
  doc.setFillColor(...colors.green);
  doc.circle(x, y - 1, 1.1, "F");
  return writeWrapped(doc, text, x + 5, y, width - 5, 10, color, 1.35) + 6;
}

function slideCard(doc, x, y, width, height, title, body, accent = colors.green) {
  doc.setFillColor(...colors.white);
  doc.setDrawColor(...colors.line);
  doc.roundedRect(x, y, width, height, 3, 3, "FD");
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, width, 2.2, 1, 1, "F");
  setFont(doc, 12, "bold", colors.ink);
  doc.text(title, x + 8, y + 12);
  writeWrapped(doc, body, x + 8, y + 21, width - 16, 9, colors.muted, 1.35);
}

function addSlide(doc, draw) {
  doc.addPage([297, 167], "landscape");
  draw(doc);
}

function drawPresentation() {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [297, 167] });
  const team = "Binaryspot  |  Anuj Nayak (Team Leader)  |  Shlok Soni";
  const college = "Birla Institute of Technology Mesra  |  Incubator: not specified";

  doc.setFillColor(20, 69, 61);
  doc.rect(0, 0, 297, 167, "F");
  doc.setFillColor(31, 119, 99);
  doc.roundedRect(17, 24, 8, 8, 2, 2, "F");
  setFont(doc, 9, "bold", [191, 230, 215]);
  doc.text("HAPPIEST HEALTH  |  DIGITAL TWIN CHALLENGE 2026", 17, 17);
  setFont(doc, 33, "bold", colors.white);
  doc.text("PulseTwin", 17, 57);
  setFont(doc, 19, "normal", [222, 239, 231]);
  doc.text("A context-aware diabetes digital twin PoC", 17, 72);
  writeWrapped(
    doc,
    "Demonstrating a two-hour synthetic glucose-excursion trend projection by pairing a simulated wearable stream with historical EHR context.",
    17,
    87,
    225,
    12,
    [222, 239, 231],
    1.45,
  );
  setFont(doc, 10, "bold", colors.white);
  doc.text(team, 17, 132);
  setFont(doc, 9, "normal", [191, 230, 215]);
  doc.text(college, 17, 141);
  doc.setFillColor(255, 245, 239);
  doc.roundedRect(17, 149, 119, 9, 2, 2, "F");
  setFont(doc, 7, "bold", [151, 72, 52]);
  doc.text("SYNTHETIC RESEARCH DEMO  -  NOT A MEDICAL DEVICE", 21, 155);

  addSlide(doc, (page) => {
    slideBase(page, 2, "01 / focused use case", "Make one risk concrete", "A focused, testable prototype is more credible than claiming a whole-body digital twin.");
    slideCard(page, 16, 54, 123, 75, "Condition", "Type 2 diabetes in a synthetic patient context, with historical HbA1c, BMI, diagnoses, and medication.", colors.blue);
    slideCard(page, 157, 54, 124, 75, "Demonstration target", "Flag when the recent synthetic glucose trend extrapolates across an illustrative 180 mg/dL threshold within a 120-minute horizon.", colors.coral);
    slideBullet(page, "Intended interaction: a clinician-facing concept dashboard for inspecting inputs, trend direction, and model rationale.", 22, 143, 255);
  });

  addSlide(doc, (page) => {
    slideBase(page, 3, "02 / architecture", "Two streams, one inspectable twin", "Every input and output in this prototype is synthetic and labelled as such.");
    slideCard(page, 16, 54, 75, 69, "Static EHR", "Synthetic profile: demographics, diagnoses, BMI, HbA1c, medications.", colors.blue);
    slideCard(page, 111, 54, 75, 69, "FastAPI", "Patient profile endpoint, accelerated WebSocket stream, scenario controls.");
    slideCard(page, 206, 54, 75, 69, "Demo models + UI", "Current-input index, two-hour trend estimate, component explanation.");
    drawArrow(page, 91, 88, 111, 88, "", 0, 0);
    drawArrow(page, 186, 88, 206, 88, "", 0, 0);
    slideCard(page, 16, 127, 265, 22, "Simulated sensor stream", "Glucose + heart rate; each one-second tick represents five simulated minutes.", colors.coral);
  });

  addSlide(doc, (page) => {
    slideBase(page, 4, "03 / data and sandbox", "Privacy-first by design", "The public PoC contains no real identifiable patient data.");
    slideCard(page, 16, 54, 122, 73, "Historical / static", "Local synthetic EHR JSON\nDemographics and diagnoses\nHbA1c and BMI\nMedication list", colors.blue);
    slideCard(page, 158, 54, 123, 73, "Dynamic / simulated", "Generated glucose (mg/dL)\nGenerated heart rate (bpm)\nFive-minute virtual intervals\nSeeded counterfactual traces", colors.coral);
    slideBullet(page, "No external or open clinical dataset is used; no model training or clinical validation is claimed.", 22, 143, 255);
  });

  addSlide(doc, (page) => {
    slideBase(page, 5, "04 / model", "Separate current state from future trend", "Transparent demonstration logic; no trained machine-learning model or outcome labels.");
    slideCard(page, 16, 52, 126, 79, "Current-input index", "Weighted demo score from current glucose, short-term change, HbA1c, BMI, and heart rate. Components are shown; score is not a probability.", colors.blue);
    slideCard(page, 155, 52, 126, 79, "Two-hour extrapolation", "Least-squares line over up to 12 five-minute samples. Report projected glucose, slope, crossing time, and threshold state. Requires 3 samples.", colors.green);
    slideBullet(page, "The projected contextual index combines extrapolated glucose with synthetic EHR HbA1c/BMI and current heart rate.", 22, 145, 255);
  });

  addSlide(doc, (page) => {
    slideBase(page, 6, "05 / clinician concept", "What the dashboard makes visible", "A concept UI for exploring an evolving synthetic virtual patient.");
    slideCard(page, 16, 53, 82, 73, "Live overview", "Synthetic patient banner\nGlucose + heart-rate readings\nCurrent-input index and components", colors.blue);
    slideCard(page, 108, 53, 82, 73, "Forecast view", "Historical glucose curve\nDashed two-hour projection\nIllustrative crossing status", colors.green);
    slideCard(page, 200, 53, 81, 73, "Explore and export", "Guided scenario replay\nSame-profile counterfactual\nJSON and PDF snapshots", colors.coral);
    slideBullet(page, "All controls and reports retain synthetic-data and non-clinical-use notices.", 22, 142, 255);
  });

  addSlide(doc, (page) => {
    slideBase(page, 7, "06 / reproducible demonstration", "What the scripted traces show", "Software behavior only - not model accuracy or a clinical outcome.");
    slideCard(page, 16, 53, 123, 72, "Steady synthetic trace", "The seeded same-profile trace stays below the illustrative crossing condition in the demonstrated comparison.", colors.green);
    slideCard(page, 157, 53, 124, 72, "Rising synthetic trace", "The comparison flags a projected crossing during the scripted rise; later samples are already above the demo threshold.", colors.coral);
    slideBullet(page, "Counterfactual control: same EHR profile and heart-rate sequence; glucose trajectory changes.", 22, 142, 255);
  });

  addSlide(doc, (page) => {
    slideBase(page, 8, "07 / safety and limitations", "A prototype is not clinical evidence", "We are explicit about what this model cannot establish.");
    const bullets = [
      "Synthetic data only; the excursion threshold is an illustrative software setting, not a clinical cutoff.",
      "Linear extrapolation assumes the recent slope continues; it can overshoot when a trend turns or plateaus.",
      "No outcome labels, external benchmark, sensitivity, specificity, calibration, or prospective evaluation.",
      "Neither output supports diagnosis, medication changes, treatment decisions, or patient triage.",
    ];
    let y = 58;
    for (const bullet of bullets) y = slideBullet(page, bullet, 23, y, 253);
    page.setFillColor(255, 245, 239);
    page.roundedRect(16, 127, 265, 18, 3, 3, "F");
    setFont(page, 9, "bold", [151, 72, 52]);
    page.text("Not for diagnosis, treatment, or medication decisions.", 23, 138);
  });

  addSlide(doc, (page) => {
    slideBase(page, 9, "08 / next phase", "How we would evaluate responsibly", "Move from a behavior demo to a measurable research prototype.");
    const steps = [
      "Select a documented, appropriately licensed synthetic/open dataset with event labels.",
      "Predefine the glucose-excursion target, prediction horizon, and evaluation cohort.",
      "Split by patient; prevent temporal and patient-level leakage.",
      "Compare to persistence and simple trend baselines; report event sensitivity, false alerts, lead time, and calibration.",
      "Review definitions and interpretation with clinical and data-governance experts.",
    ];
    let y = 54;
    for (const step of steps) y = slideBullet(page, step, 23, y, 252);
  });

  addSlide(doc, (page) => {
    slideBase(page, 10, "09 / summit submission", "A clear 20-minute walkthrough", "Suggested recording outline; the team still needs to record and link the video.");
    slideCard(page, 16, 52, 122, 78, "Video run of show", "Problem + use case: 3 min\nData + privacy: 3 min\nArchitecture + model: 4 min\nLive walkthrough: 7 min\nLimitations + next steps: 3 min", colors.blue);
    slideCard(page, 156, 52, 125, 78, "Before submission", "Add the recorded video URL\nConfirm public GitHub repository\nVerify team registration details\nConfirm each member approves public details", colors.coral);
    slideBullet(page, "Open-source license: MIT (see repository LICENSE).", 22, 144, 255);
  });

  doc.save(resolve(docsPath, "project-presentation.pdf"));
}

drawArchitecture();
drawPresentation();
console.log(`Generated submission PDFs in ${docsPath}`);
