import { z } from "zod";
export const services = [
  {
    id: "ux-strategy",
    name: "UX strategy & audits",
    description: "Find friction and decide what to improve.",
    questions: [
      "Which website or product should we review?",
      "Who uses it, and where are they getting stuck?",
      "What would a successful outcome look like?",
    ],
  },
  {
    id: "product-design",
    name: "Website & digital product design",
    description: "Plan a new experience or improve an existing one.",
    questions: [
      "Is this a new product or a redesign?",
      "Which pages, screens, or features do you need?",
      "Who is the audience and what should they be able to do?",
    ],
  },
  {
    id: "prototype",
    name: "Interactive prototypes",
    description: "Explore and test an experience before development.",
    questions: [
      "Which journeys or interactions should the prototype demonstrate?",
      "What designs or research already exist?",
      "Who will use the prototype and what decision will it support?",
    ],
  },
  {
    id: "design-system",
    name: "Design systems & UI consistency",
    description: "Create reusable components and clearer design rules.",
    questions: [
      "Which products or platforms will use the system?",
      "What components or guidelines already exist?",
      "Where are consistency or collaboration problems showing up?",
    ],
  },
  {
    id: "brand-campaign",
    name: "Brand & campaign design",
    description: "Discuss visual identity, messaging, or campaign assets.",
    questions: [
      "What brand or campaign are we designing for?",
      "Which digital assets or channels do you need?",
      "What should your audience understand or do?",
    ],
  },
  {
    id: "other",
    name: "Something else / help me decide",
    description: "Describe the challenge and we will find a starting point.",
    questions: [
      "What are you trying to accomplish?",
      "What help do you think you need?",
      "What should we know before we follow up?",
    ],
  },
] as const;
export const serviceRequestSchema = z.object({
  submission_id: z.string().uuid(),
  service: z.enum([
    "ux-strategy",
    "product-design",
    "prototype",
    "design-system",
    "brand-campaign",
    "other",
  ]),
  title: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(12000),
  client_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  answers: z.array(z.string().trim().min(1).max(3000)).length(3),
  budget: z.string().max(100),
  desired_date: z.string().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v)),
  references: z.string().max(3000),
  project_id: z.string().uuid().nullable().optional(),
  website: z.string().max(0).optional(),
  captcha_token: z.string().max(4096).optional(),
});
export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;
export function requestDetails(input: ServiceRequestInput) {
  const service = services.find((s) => s.id === input.service)!;
  return {
    service_id: input.service,
    answers: input.answers,
    service: service.name,
    contact_email: input.email,
    budget: input.budget,
    references: input.references,
    ...Object.fromEntries(
      service.questions.map((q, i) => [q, input.answers[i]]),
    ),
  };
}
