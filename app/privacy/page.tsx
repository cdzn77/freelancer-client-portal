import { brand } from "../../lib/brand";
import { PublicInformation } from "@/components/public-information";
export const metadata = { title: `Privacy | ${brand.name}` };
export default function Page() { return <PublicInformation title="Privacy"><p>The operator of this portal must publish their privacy notice here before collecting client information. It should identify the operator, hosting and connected service providers, data use, retention, and how clients can request access or deletion.</p><p>Contact <a href={`mailto:${brand.email}`}>{brand.email}</a>.</p></PublicInformation>; }
