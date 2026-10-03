"use strict";

// Project-local bitmap examples with deliberately different styles and palettes.
async function loadDefaultSamples() {
  const samples = [
    { name: "Bright cat", style: "Pop art", file: "bright-cat.png" },
    { name: "Sci-fi robot", style: "Cartoon sci-fi", file: "cartoon-robot.png" },
    { name: "Coastal boat", style: "Natural photography", file: "realistic-boat.png" },
    { name: "Earth", style: "Flat illustration", file: "earth.png" },
    { name: "Citrus print", style: "Linocut print", file: "citrus-print.png" }
  ];
  return Promise.all(samples.map(async sample => {
    const response = await fetch(`./samples/${sample.file}`);
    if (!response.ok) throw new Error(`Could not load ${sample.name}.`);
    return { ...sample, blob: await response.blob() };
  }));
}
