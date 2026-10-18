import assert from "node:assert/strict";
import test from "node:test";
import { deriveReferenceVisualSystem, referenceCopyLayout, referenceFidelityBrief } from "../lib/reference-fidelity.ts";
import type { ReferenceAnalysisResult } from "../lib/reference-types.ts";

const analysis:ReferenceAnalysisResult={
  summary:"Burst cover",
  visualStyle:{colorPalette:["Near-black","Bright cyan/aqua","White","Warm yellow","Deep burgundy/red"],composition:"Portrait cover with subjects above and a headline in the lower third.",typography:"Bold uppercase type",imagery:"A centered silhouette lineup",lighting:"Bright radial backlight",texture:"Energetic radial streaks"},
  contentStrategy:{hook:"",pacing:"",storyStructure:"",cta:""},reusablePatterns:[],avoidCopying:[],frameNotes:[],
};

test("derives a reusable visual system from the selected reference",()=> {
  assert.deepEqual(deriveReferenceVisualSystem(analysis).palette,["#57e6ee","#f7f6ee","#07090a"]);
  assert.equal(referenceCopyLayout(analysis),"lower");
});

test("fidelity brief preserves structure while replacing protected subjects",()=> {
  const brief=referenceFidelityBrief(analysis);
  assert.match(brief,/Preserve this palette closely/);
  assert.match(brief,/Keep the reference's approximate focal-zone placement/);
  assert.match(brief,/Replace every recognizable character/);
});
