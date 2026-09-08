// Other products of ours whose teams record their own meetings with Ledgeur.
// Logos are pulled from each product's own site: an SVG mark where the
// header exposes one (recoloured to currentColor so it sits cleanly in the
// strip), a small raster image where it doesn't, and a plain wordmark for
// the few sites whose header logo is text-only.
//
// This list is reviewed by hand, not generated: every entry was confirmed
// live (its own domain resolving, not parked) before being added.

export interface Customer {
  name: string;
  url: string;
  /** File under /public/logos, for kind "svg" | "img". */
  logo?: string;
  kind: "svg" | "img" | "text";
}

export const CUSTOMERS: Customer[] = [
  { name: "GradeHack", url: "https://gradehack.com", kind: "img", logo: "gradehack.png" },
  { name: "Benefily", url: "https://benefily.com", kind: "svg", logo: "benefily.svg" },
  { name: "Bill100", url: "https://bill100.com", kind: "svg", logo: "bill100.svg" },
  { name: "Brandmity", url: "https://brandmity.com", kind: "svg", logo: "brandmity.svg" },
  { name: "Chartely", url: "https://chartely.com", kind: "svg", logo: "chartely.svg" },
  { name: "Classify7", url: "https://classify7.com", kind: "svg", logo: "classify7.svg" },
  { name: "Conformery", url: "https://conformery.com", kind: "text" },
  { name: "Contextely", url: "https://contextely.com", kind: "svg", logo: "contextely.svg" },
  { name: "Contract10", url: "https://contract10.com", kind: "svg", logo: "contract10.svg" },
  { name: "DeckHelm", url: "https://deckhelm.com", kind: "svg", logo: "deckhelm.svg" },
  { name: "Denial7", url: "https://denial7.com", kind: "svg", logo: "denial7.svg" },
  { name: "Duebay", url: "https://duebay.com", kind: "svg", logo: "duebay.svg" },
  { name: "Event70", url: "https://event70.com", kind: "svg", logo: "event70.svg" },
  { name: "Feedlark", url: "https://feedlark.com", kind: "svg", logo: "feedlark.svg" },
  { name: "Foundily", url: "https://foundily.com", kind: "svg", logo: "foundily.svg" },
  { name: "Frifti", url: "https://frifti.com", kind: "img", logo: "frifti.png" },
  { name: "Grannio", url: "https://grannio.com", kind: "svg", logo: "grannio.svg" },
  { name: "InkRobin", url: "https://inkrobin.com", kind: "svg", logo: "inkrobin.svg" },
  { name: "Job13", url: "https://job13.com", kind: "svg", logo: "job13.svg" },
  { name: "JobPlumb", url: "https://jobplumb.com", kind: "svg", logo: "jobplumb.svg" },
  { name: "Ledgerage", url: "https://ledgerage.com", kind: "svg", logo: "ledgerage.svg" },
  { name: "Ledgerary", url: "https://ledgerary.com", kind: "svg", logo: "ledgerary.svg" },
  { name: "Ledgerler", url: "https://ledgerler.com", kind: "svg", logo: "ledgerler.svg" },
  { name: "Lugbird", url: "https://lugbird.com", kind: "svg", logo: "lugbird.svg" },
  { name: "Mealary", url: "https://mealary.com", kind: "svg", logo: "mealary.svg" },
  { name: "Meterary", url: "https://meterary.com", kind: "text" },
  { name: "ModelCharter", url: "https://modelcharter.com", kind: "svg", logo: "modelcharter.svg" },
  { name: "Patent77", url: "https://patent77.com", kind: "svg", logo: "patent77.svg" },
  { name: "Patientary", url: "https://patientary.com", kind: "svg", logo: "patientary.svg" },
  { name: "PerDiemWise", url: "https://perdiemwise.com", kind: "text" },
  { name: "PermitBird", url: "https://permitbird.com", kind: "svg", logo: "permitbird.svg" },
  { name: "PortRobin", url: "https://portrobin.com", kind: "svg", logo: "portrobin.svg" },
  { name: "RenewBird", url: "https://renewbird.com", kind: "svg", logo: "renewbird.svg" },
  { name: "Rigbird", url: "https://rigbird.com", kind: "svg", logo: "rigbird.svg" },
  { name: "RoofHelm", url: "https://roofhelm.com", kind: "svg", logo: "roofhelm.svg" },
  { name: "RotaBay", url: "https://rotabay.com", kind: "svg", logo: "rotabay.svg" },
  { name: "Scoutern", url: "https://scoutern.com", kind: "svg", logo: "scoutern.svg" },
  { name: "Screen100", url: "https://screen100.com", kind: "svg", logo: "screen100.svg" },
  { name: "Slopeify", url: "https://slopeify.com", kind: "svg", logo: "slopeify.svg" },
  { name: "Sourceory", url: "https://sourceory.com", kind: "svg", logo: "sourceory.svg" },
  { name: "Spend7", url: "https://spend7.com", kind: "svg", logo: "spend7.svg" },
  { name: "TableHelm", url: "https://tablehelm.com", kind: "svg", logo: "tablehelm.svg" },
  { name: "ThreadCamp", url: "https://threadcamp.com", kind: "svg", logo: "threadcamp.svg" },
  { name: "Trial0", url: "https://trial0.com", kind: "svg", logo: "trial0.svg" },
  { name: "Under Haus", url: "https://underhaus.com", kind: "img", logo: "underhaus.png" },
  { name: "Vouchity", url: "https://vouchity.com", kind: "svg", logo: "vouchity.svg" },
  { name: "WageCoach", url: "https://wagecoach.com", kind: "svg", logo: "wagecoach.svg" },
  { name: "WatermarkRemoverPro", url: "https://watermarkremoverpro.com", kind: "img", logo: "watermarkremoverpro.png" },
  { name: "WillThisHappen", url: "https://willthishappen.com", kind: "text" },
];
