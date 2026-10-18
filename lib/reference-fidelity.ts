import type { CarouselVisualSystem, ReferenceAnalysisResult } from "./reference-types";

export type ReferenceCopyLayout = "upper" | "center" | "lower";

function colorHex(description:string):string {
  const value=description.toLowerCase();
  if (value.includes("cyan")||value.includes("aqua")||value.includes("turquoise")) return "#57e6ee";
  if (value.includes("yellow")||value.includes("gold")) return "#ffd447";
  if (value.includes("burgundy")||value.includes("maroon")) return "#741528";
  if (value.includes("red")) return "#b82432";
  if (value.includes("lime")) return "#d9ef58";
  if (value.includes("green")) return "#238b66";
  if (value.includes("blue")) return "#287dcc";
  if (value.includes("purple")||value.includes("violet")) return "#7447b8";
  if (value.includes("orange")) return "#ef7d32";
  if (value.includes("white")||value.includes("cream")) return "#f7f6ee";
  if (value.includes("black")||value.includes("charcoal")) return "#07090a";
  return "#56616a";
}

export function deriveReferenceVisualSystem(analysis:ReferenceAnalysisResult):CarouselVisualSystem {
  const colors=[...new Set(analysis.visualStyle.colorPalette.map(colorHex))];
  const surface=colors.find((color)=>color==="#07090a")||"#081713";
  const accents=colors.filter((color)=>color!==surface);
  const fallback=["#d9ef58","#43ced0"];
  while(accents.length<2) accents.push(fallback[accents.length]);
  return {
    palette:[accents[0],accents[1],surface],
    typography:analysis.visualStyle.typography,
    maskTreatment:`Reference-led composition: ${analysis.visualStyle.composition}`,
  };
}

export function referenceCopyLayout(analysis:ReferenceAnalysisResult):ReferenceCopyLayout {
  const composition=analysis.visualStyle.composition.toLowerCase();
  if (/lower third|bottom third|lower portion|bottom portion|headline.*(?:lower|bottom)/.test(composition)) return "lower";
  if (/upper third|top third|upper portion|top portion|headline.*(?:upper|top)/.test(composition)) return "upper";
  return "center";
}

export function referenceFidelityBrief(analysis:ReferenceAnalysisResult) {
  return [
    "REFERENCE FIDELITY IS THE PRIMARY ART-DIRECTION REQUIREMENT.",
    `Preserve this palette closely: ${analysis.visualStyle.colorPalette.join(", ")}. Keep the same dominant-to-accent color balance.`,
    `Preserve the major spatial composition and visual hierarchy: ${analysis.visualStyle.composition}`,
    `Preserve the typography's placement, scale relationships, weight, and rhythm: ${analysis.visualStyle.typography}`,
    `Preserve the lighting and energy: ${analysis.visualStyle.lighting}`,
    `Preserve the texture and depth treatment: ${analysis.visualStyle.texture}`,
    `Use this imagery only as a spatial guide: ${analysis.visualStyle.imagery}`,
    "Replace every recognizable character, product, logo, package, creator mark, and protected silhouette with original category-neutral geometry or abstract collector objects. Keep the reference's approximate focal-zone placement, grouping rhythm, silhouette mass, negative space, and copy zone; do not replace it with an unrelated scene or a generic template.",
  ].join("\n");
}
