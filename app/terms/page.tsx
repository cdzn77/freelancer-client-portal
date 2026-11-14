import { brand } from "../../lib/brand";
import { PublicInformation } from "@/components/public-information";
export const metadata = { title: `Terms | ${brand.name}` };
export default function Page() { return <PublicInformation title="Terms"><p>The operator of this portal must publish their terms here before inviting clients. The repository license covers the software. It does not define the agreement between a freelancer and their clients.</p><p>Contact <a href={`mailto:${brand.email}`}>{brand.email}</a>.</p></PublicInformation>; }
