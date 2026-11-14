
import { brand } from "./brand";
import { services } from "./service-catalog";
import { standardTerms, type ClientDocument } from "./client-documents";
export function documentTemplate(
  serviceName: string,
  kind: ClientDocument["kind"],
) {
  const service = services.find((s) => s.name === serviceName) || services[0];
  const copy: Record<string, { scope: string; deliverables: string }> = {
    "ux-strategy": {
      scope:
        (brand.name + " will assess the agreed user journeys against the needs of the audience and the goals of the business. The review will identify barriers, explain their significance, and organize recommendations into a practical sequence for improvement. Research methods and access requirements will be confirmed in the scope."),
      deliverables:
        "UX findings and recommendations\nPrioritized improvement roadmap\nReview presentation\nAgreed pages, journeys, and revision rounds: specify before sharing.",
    },
    "product-design": {
      scope:
        (brand.name + " will design the agreed pages and screens for desktop and mobile. Reviews will test whether people can find information and complete the intended tasks. The handoff includes the design files and implementation notes listed below."),
      deliverables:
        "Approved page and screen inventory\nResponsive interface designs\nDesign handoff and component specifications\nIncluded breakpoints, revision rounds, and implementation responsibilities: specify before sharing.",
    },
    prototype: {
      scope:
        (brand.name + " will build a clickable prototype of the agreed user flows. The client can review how screens connect and respond before development begins. User testing and participant recruitment are included only when listed in the scope."),
      deliverables:
        "Interactive prototype\nInteraction and flow notes\nReview walkthrough\nIncluded journeys, testing responsibilities, and revision rounds: specify before sharing. Production development is outside scope unless listed.",
    },
    "design-system": {
      scope:
        (brand.name + " will create the agreed component library and document how to use it. Each component will include the interaction states listed in the scope. The agreement must identify who maintains the library and whether code implementation is included."),
      deliverables:
        "Component library\nTypography, spacing, and interface guidelines\nUsage and handoff documentation\nIncluded components, platforms, revision rounds, and code implementation: specify before sharing.",
    },
    "brand-campaign": {
      scope:
        (brand.name + " will turn the agreed positioning and message into a focused visual direction for the selected digital channels. Concepts will be evaluated against the audience, communication goal, and brand character. Approved work will be developed into the asset formats and usage guidance listed in this engagement."),
      deliverables:
        "Approved digital asset list\nVisual direction and final exports\nUsage guidance\nIncluded concepts, formats, licensing, and revision rounds: specify before sharing. Physical production is excluded.",
    },
    other: {
      scope:
        "Describe the agreed problem, audience, objectives, and boundaries of this engagement.",
      deliverables:
        "List the exact digital deliverables, formats, milestones, exclusions, and included revision rounds.",
    },
  };
  const base = copy[service.id];
  const engagement =
    "THE CHALLENGE\n[Describe the business problem, audience, and current experience.]\n\nTHE OUTCOME\n[Define the intended improvement, baseline where available, and how it will be evaluated. State which outcomes this engagement can influence and which depend on implementation or other factors.]\n\nOUR APPROACH\n" +
    base.scope +
    "\n\nMILESTONES & COLLABORATION\n[Confirm the decision and deliverable at each milestone, review dates, and handoff. Name the client approver and required inputs. Include research or testing only if agreed in scope.]";
  const scopes: Record<ClientDocument["kind"], string> = {
    Estimate:
      "This estimate outlines the proposed engagement, deliverables, and investment for " +
      service.name.toLowerCase() +
      ". The scope and schedule will be confirmed through approval before work begins.\n\n" +
      engagement,
    Contract:
      "This working agreement defines the " +
      service.name.toLowerCase() +
      (" services " + brand.name + " will provide, the responsibilities of each party, and the commercial terms governing the engagement.\n\n") +
      engagement,
    "Project agreement":
      "This agreement brings the approved direction, deliverables, schedule, and investment together for " +
      service.name.toLowerCase() +
      ". It is the shared reference for delivery and review.\n\n" +
      engagement,
    "Creative brief":
      "This brief aligns the business context and creative direction for " +
      service.name.toLowerCase() +
      ". It guides design decisions; it does not authorize additional scope or spending.\n\nBUSINESS & CONTEXT\n[Describe the organization, offering, and challenge.]\n\nOBJECTIVES & DESIRED PERCEPTION\n[Define the intended outcome and how the brand should be perceived.]\n\nAUDIENCE & COMPETITION\n[Describe the primary audience, needs, alternatives, and competitors.]\n\nSUCCESS CRITERIA\n[Define the evidence that will demonstrate success.]\n\nMARKETING & CREATIVE DIRECTION\n[Describe previous efforts, key messages, brand attributes, preferences, and constraints.]\n\nSERVICE FOCUS\n" +
      base.scope,
    Invoice:
      "This invoice itemizes the agreed " +
      service.name.toLowerCase() +
      " services and the payment milestone being billed. Amounts must correspond to the approved engagement.\n\nAGREEMENT & BILLING REFERENCE\n[Confirm the agreement reference, invoice reference, and issue date.]\n\nSERVICES & BILLING PERIOD\n[Describe the authorized work and the period or milestone covered. Identify whether this is a deposit or final-payment request.]\n\nPAYMENT DUE\n[Confirm the due date, previous verified payments, and the amount currently due. Do not bill a previously received deposit twice.]",
    "Change order":
      "This change order records an adjustment to the approved " +
      service.name.toLowerCase() +
      " engagement. Only the changes listed here are proposed; all unaffected terms remain in place. The change requires approval before additional work begins.\n\nORIGINAL AGREEMENT\n[Confirm the original agreement reference and date.]\n\nREQUESTED CHANGE\n[Describe what is being added, removed, or modified.]\n\nREASON FOR CHANGE\n[Describe the new requirement or decision behind the change.]\n\nFEE & SCHEDULE IMPACT\n[Confirm added or reduced fees, additional effort, affected milestones, and revised delivery date.]",
  };
  return {
    title: `${service.name}: ${kind.toLowerCase()}`,
    scope: scopes[kind],
    deliverables:
      base.deliverables +
      "\n\nACCEPTANCE & BOUNDARIES\n[Define acceptance criteria, included review rounds, feedback turnaround, and exclusions. Changes require written approval.]",
    terms: standardTerms,
    line: service.name,
  };
}
export type DocumentWording = Pick<
  ReturnType<typeof documentTemplate>,
  "title" | "scope" | "deliverables" | "terms"
>;
/** Only replace untouched generated wording; preserve client-specific edits. */
export function updateGeneratedWording(
  current: DocumentWording,
  previous: DocumentWording,
  next: DocumentWording,
): DocumentWording {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      value === previous[key as keyof DocumentWording]
        ? next[key as keyof DocumentWording]
        : value,
    ]),
  ) as DocumentWording;
}
